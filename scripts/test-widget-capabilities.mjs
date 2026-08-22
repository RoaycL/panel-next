import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'
import { createSSRApp, defineComponent, h, inject, provide } from 'vue'
import { renderToString } from 'vue/server-renderer'

function cleanImports(src) {
  return src.replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"][^'"]+['"];?/g, '')
}

const capabilitiesSource = cleanImports(fs.readFileSync(new URL('../src/widgets/capabilities.ts', import.meta.url), 'utf8'))
const actionsSource = cleanImports(fs.readFileSync(new URL('../src/widgets/actions.ts', import.meta.url), 'utf8'))
const contextSource = cleanImports(fs.readFileSync(new URL('../src/widgets/context.ts', import.meta.url), 'utf8'))

// Mock runtime storage and navigator APIs
const mockStorageMap = new Map()
const mockOpenUrlCalls = []
const mockClipboardWriteCalls = []
const mockGeolocationCalls = []

const mockRuntime = {
  kind: 'web',
  storage: {
    getItem: key => mockStorageMap.get(key) ?? null,
    setItem: (key, val) => { mockStorageMap.set(key, String(val)) },
    removeItem: (key) => { mockStorageMap.delete(key) },
    keys: () => Array.from(mockStorageMap.keys()),
    flush: async () => {},
  },
  openUrl: (url, mode) => {
    mockOpenUrlCalls.push({ url, mode })
  },
}

Object.defineProperty(globalThis, 'navigator', {
  value: {
    clipboard: {
      writeText: async (text) => {
        mockClipboardWriteCalls.push(text)
      },
    },
    geolocation: {
      getCurrentPosition: (success, error, options) => {
        mockGeolocationCalls.push(options)
        success({
          coords: {
            latitude: 31.2304,
            longitude: 121.4737,
            accuracy: 10,
          },
          timestamp: Date.now(),
        })
      },
    },
  },
  configurable: true,
  writable: true,
})

globalThis.window = {
  location: {
    href: 'http://localhost:3000/',
  },
}

globalThis.vueInject = inject

const bundlePreamble = `
export function inject(key, fallback) {
  return globalThis.vueInject(key, fallback)
}

export function getRuntime() {
  return globalThis.mockRuntime
}

export function t(key) {
  return key
}

export function createDiscreteApi() {
  return {
    message: {
      info: () => {},
      success: () => {},
      warning: () => {},
      error: () => {},
    },
    dialog: {
      warning: (opts) => { opts.onPositiveClick?.() },
    },
  }
}
`

const bundleCode = [
  bundlePreamble,
  capabilitiesSource,
  contextSource,
  actionsSource,
].join('\n')

const transpiled = ts.transpileModule(bundleCode, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'widget-capabilities-bundle.ts',
  reportDiagnostics: true,
})
if (transpiled.diagnostics?.length) {
  const msgs = transpiled.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  throw new Error(`Failed to transpile capabilities bundle:\n${msgs.join('\n')}`)
}

globalThis.mockRuntime = mockRuntime

const encoded = Buffer.from(transpiled.outputText).toString('base64')
const mod = await import(`data:text/javascript;base64,${encoded}`)

const {
  WIDGET_CONTEXT_KEY,
  WidgetPermissionError,
  hasContextCapability,
  assertContextCapability,
  assertCapability,
  useWidgetActions,
  useWidgetStorage,
} = mod

console.log('--- Running Pure Function Capabilities Tests ---')

// 1. Pure capability check functions
const authorizedContext = {
  instanceId: 'clock-1',
  type: 'core.clock',
  capabilities: ['clipboard', 'storage'],
  editMode: false,
  surface: 'web',
}

const emptyContext = {
  instanceId: 'clock-2',
  type: 'core.clock',
  capabilities: [],
  editMode: false,
  surface: 'web',
}

assert.equal(hasContextCapability(authorizedContext, 'clipboard'), true)
assert.equal(hasContextCapability(authorizedContext, 'storage'), true)
assert.equal(hasContextCapability(authorizedContext, 'geolocation'), false)
assert.equal(hasContextCapability(authorizedContext, 'network'), false)

assert.equal(hasContextCapability(emptyContext, 'clipboard'), false)
assert.equal(hasContextCapability(null, 'clipboard'), false)
assert.equal(hasContextCapability(undefined, 'clipboard'), false)

assert.doesNotThrow(() => assertContextCapability(authorizedContext, 'clipboard'))
assert.throws(() => assertContextCapability(authorizedContext, 'geolocation'), err => err instanceof WidgetPermissionError)
assert.throws(() => assertContextCapability(null, 'clipboard'), err => err instanceof WidgetPermissionError)

console.log('Passed Pure Capability checks.')

console.log('--- Running Real Vue Provider / WidgetHost Lifecycle Tests ---')

let capturedActions = null
let capturedStorage = null
let capturedError = null

const MockWidgetHost = defineComponent({
  props: ['context'],
  setup(props, { slots }) {
    provide(WIDGET_CONTEXT_KEY, props.context)
    return () => slots.default?.()
  },
})

const TestWidget = defineComponent({
  setup() {
    try {
      capturedActions = useWidgetActions()
      capturedStorage = useWidgetStorage()
      assertCapability('clipboard')
    }
    catch (err) {
      capturedError = err
    }
    return () => h('div', { class: 'widget-content' }, 'rendered')
  },
})

// Test 1: Full Vue App Mount with Authorized Capabilities
const appAuthorized = createSSRApp({
  render() {
    return h(MockWidgetHost, { context: authorizedContext }, () => h(TestWidget))
  },
})

await renderToString(appAuthorized)

assert.equal(capturedError, null)
assert.notEqual(capturedActions, null)
assert.notEqual(capturedStorage, null)

// Actions work in Vue context
mockClipboardWriteCalls.length = 0
await capturedActions.copy('test text via actions')
assert.equal(mockClipboardWriteCalls.length, 1)
assert.equal(mockClipboardWriteCalls[0], 'test text via actions')

// Storage works in Vue context
mockStorageMap.clear()
await capturedStorage.write('setting_key', { theme: 'dark' })
const readBack = capturedStorage.read('setting_key')
assert.deepEqual(readBack, { theme: 'dark' })

// Test 2: Full Vue App Mount with Missing Capability -> Throws WidgetPermissionError during setup
let unauthError = null
const TestUnauthWidget = defineComponent({
  setup() {
    try {
      assertCapability('geolocation') // unauthorized
    }
    catch (err) {
      unauthError = err
    }
    return () => h('div', 'unauth')
  },
})

const appUnauth = createSSRApp({
  render() {
    return h(MockWidgetHost, { context: authorizedContext }, () => h(TestUnauthWidget))
  },
})

await renderToString(appUnauth)
assert.equal(unauthError instanceof WidgetPermissionError, true)
assert.equal(unauthError.capability, 'geolocation')

console.log('Passed Real Vue Provider & WidgetHost Lifecycle Tests.')
console.log('✅ ALL Widget Capabilities Unit Tests Passed!')
