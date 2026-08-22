import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

function cleanImports(src) {
  return src.replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"][^'"]+['"];?/g, '')
}

const appearanceSource = cleanImports(fs.readFileSync(new URL('../src/runtime/extensionAppearance.ts', import.meta.url), 'utf8'))
const contextSource = cleanImports(fs.readFileSync(new URL('../src/widgets/context.ts', import.meta.url), 'utf8'))
const registrySource = cleanImports(fs.readFileSync(new URL('../src/widgets/registry.ts', import.meta.url), 'utf8'))
const typesSource = cleanImports(fs.readFileSync(new URL('../src/widgets/types.ts', import.meta.url), 'utf8'))
const constantsSource = cleanImports(fs.readFileSync(new URL('../src/widgets/constants.ts', import.meta.url), 'utf8'))
const extensionSource = cleanImports(fs.readFileSync(new URL('../src/runtime/extension.ts', import.meta.url), 'utf8'))

// Two-tier Mock storage: memoryMap (adapter cache) and durableMap (underlying chrome.storage)
const memoryMap = new Map()
const durableMap = new Map()
let flushShouldFail = false
let flushCount = 0

const mockRuntime = {
  kind: 'extension',
  storage: {
    getItem: key => memoryMap.get(key) ?? null,
    setItem: (key, val) => {
      memoryMap.set(key, String(val))
    },
    removeItem: (key) => {
      memoryMap.delete(key)
    },
    keys: () => Array.from(memoryMap.keys()),
    flush: async () => {
      flushCount++
      if (flushShouldFail) {
        // Rollback memoryMap to durable state on flush failure
        memoryMap.clear()
        for (const [k, v] of durableMap.entries()) {
          memoryMap.set(k, v)
        }
        throw new Error('Disk IO error / Storage flush failed')
      }
      // On flush success: synchronize memoryMap to durableMap
      durableMap.clear()
      for (const [k, v] of memoryMap.entries()) {
        durableMap.set(k, v)
      }
    },
  },
}

const bundlePreamble = `
export function getRuntime() {
  return globalThis.mockRuntime
}

export function inject(k, f) {
  return f
}

export function resolveHttpUrl(url, base) {
  try {
    return new URL(url, base).href
  }
  catch {
    return url
  }
}
`

const bundleCode = [
  bundlePreamble,
  constantsSource,
  typesSource,
  registrySource,
  contextSource,
  appearanceSource,
  extensionSource,
].join('\n')

const transpiled = ts.transpileModule(bundleCode, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'extension-persistence-bundle.ts',
  reportDiagnostics: true,
})
if (transpiled.diagnostics?.length) {
  const msgs = transpiled.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  throw new Error(`Failed to transpile extension persistence bundle:\n${msgs.join('\n')}`)
}

globalThis.mockRuntime = mockRuntime

const encoded = Buffer.from(transpiled.outputText).toString('base64')
const mod = await import(`data:text/javascript;base64,${encoded}`)

const {
  EXTENSION_WIDGETS_KEY,
  EXTENSION_APPEARANCE_KEY,
  readExtensionWidgets,
  readExtensionAppearance,
  saveExtensionAppearance,
  saveExtensionWidgets,
  updateExtensionWidgets,
  clearWidgetStorage,
  removeExtensionWidgetFlow,
  processPendingWidgetCleanups,
  ChromeStorageAdapter,
} = mod

// Helper to suppress expected console.error and console.warn in tests
async function withMutedError(fn) {
  const originalError = console.error
  const originalWarn = console.warn
  console.error = () => {}
  console.warn = () => {}
  try {
    return await fn()
  }
  finally {
    console.error = originalError
    console.warn = originalWarn
  }
}

console.log('--- Running saveExtensionWidgets Two-Tier Storage & Deduplication Tests ---')

memoryMap.clear()
durableMap.clear()
flushCount = 0
flushShouldFail = false

const prefsA = {
  clock: true,
  search: true,
  weather: true,
  trending: true,
  contentLayout: {
    schemaVersion: 1,
    widgets: [
      { id: 'w1', type: 'core.clock', version: 1, position: { column: 0, row: 0 }, size: { columns: 2, rows: 1 }, hidden: false, config: {} },
    ],
  },
}
const storedWidgetBytes = prefs => JSON.stringify({ ...prefs, pendingWidgetCleanupIds: prefs.pendingWidgetCleanupIds ?? [] })

// 1. Initial save succeeds: both memoryMap and durableMap are updated
const saveResult1 = await saveExtensionWidgets(prefsA)
assert.equal(saveResult1, true)
assert.equal(flushCount, 1)
assert.equal(memoryMap.get(EXTENSION_WIDGETS_KEY), storedWidgetBytes(prefsA))
assert.equal(durableMap.get(EXTENSION_WIDGETS_KEY), storedWidgetBytes(prefsA))

// 2. Saving identical content skips write & flush (deduplication)
const saveResult2 = await saveExtensionWidgets(prefsA)
assert.equal(saveResult2, true)
assert.equal(flushCount, 1) // flush count remained 1

console.log('Passed saveExtensionWidgets basic & deduplication tests.')

console.log('--- Running Persistence Failure & False-Save-Success Prevention Tests ---')

// 3. When storage flush fails:
// - saveExtensionWidgets throws error
// - durableMap remains the old value (prefsA)
// - memoryMap rolls back to reliable state (prefsA)
flushShouldFail = true
const prefsB = {
  ...prefsA,
  clock: false,
}

await withMutedError(async () => {
  await assert.rejects(
    () => saveExtensionWidgets(prefsB),
    err => /Storage flush failed/i.test(err.message),
  )
})

assert.equal(durableMap.get(EXTENSION_WIDGETS_KEY), storedWidgetBytes(prefsA))
assert.equal(memoryMap.get(EXTENSION_WIDGETS_KEY), storedWidgetBytes(prefsA))

// 4. Retrying the exact same prefsB after flush is restored:
// Must NOT return a false save success from deduplication! It MUST write and flush to storage.
flushShouldFail = false
const initialFlushCount = flushCount
const retrySaveResult = await saveExtensionWidgets(prefsB)
assert.equal(retrySaveResult, true)
assert.equal(flushCount, initialFlushCount + 1)
assert.equal(durableMap.get(EXTENSION_WIDGETS_KEY), storedWidgetBytes(prefsB))
assert.equal(memoryMap.get(EXTENSION_WIDGETS_KEY), storedWidgetBytes(prefsB))

console.log('Passed Persistence Failure & False-Save-Success Prevention Tests.')

console.log('--- Running Concurrent Save Serialization & Appearance Tests ---')

// 5.1 Concurrent calls to saveExtensionWidgets serialize and preserve the latest write
const prefsC1 = { ...prefsB, weather: false }
const prefsC2 = { ...prefsB, weather: true, search: false }

const p1 = saveExtensionWidgets(prefsC1)
const p2 = saveExtensionWidgets(prefsC2)

const [res1, res2] = await Promise.all([p1, p2])
assert.equal(res1, true)
assert.equal(res2, true)
assert.equal(durableMap.get(EXTENSION_WIDGETS_KEY), storedWidgetBytes(prefsC2))
assert.equal(memoryMap.get(EXTENSION_WIDGETS_KEY), storedWidgetBytes(prefsC2))

// 5.2 saveExtensionAppearance serialization, deduplication & failure handling
const appConfig1 = { backgroundImageSrc: '/bg1.png' }
const appConfig2 = { backgroundImageSrc: '/bg2.png' }

const saveAppRes = await saveExtensionAppearance(appConfig1)
assert.equal(saveAppRes, true)
assert.equal(memoryMap.get(EXTENSION_APPEARANCE_KEY), JSON.stringify(appConfig1))

// Deduplication
const initialAppFlushCount = flushCount
await saveExtensionAppearance(appConfig1)
assert.equal(flushCount, initialAppFlushCount) // no flush

// Concurrent writes
const pa1 = saveExtensionAppearance(appConfig1)
const pa2 = saveExtensionAppearance(appConfig2)
await Promise.all([pa1, pa2])
assert.equal(memoryMap.get(EXTENSION_APPEARANCE_KEY), JSON.stringify(appConfig2))
assert.deepEqual(readExtensionAppearance(), appConfig2)

// Verify clearWidgetStorage is exported and callable
assert.equal(typeof clearWidgetStorage, 'function')

// Appearance flush failure
flushShouldFail = true
await withMutedError(async () => {
  await assert.rejects(
    () => saveExtensionAppearance({ backgroundImageSrc: '/fail.png' }),
    err => /Storage flush failed/i.test(err.message),
  )
})
flushShouldFail = false

console.log('Passed Concurrent Save Serialization & Appearance Tests.')

console.log('--- Running ChromeStorageAdapter Concurrent Write & Rollback Safety Tests ---')

// 6. ChromeStorageAdapter: when write 1 fails concurrently with write 2, write 1 must NOT roll back write 2
const mockAreaStorage = {}
let areaCallCount = 0
const mockArea = {
  get: async () => ({ ...mockAreaStorage }),
  set: async (items) => {
    areaCallCount++
    if (areaCallCount === 1) {
      // First write fails
      throw new Error('Simulated chrome.storage.local.set failure on first write')
    }
    // Second write succeeds
    Object.assign(mockAreaStorage, items)
  },
  remove: async (keys) => {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    keyArray.forEach(k => delete mockAreaStorage[k])
  },
}

const mockOnChanged = {
  addListener: () => {},
  removeListener: () => {},
  hasListener: () => false,
  hasListeners: () => false,
}

const adapter = new ChromeStorageAdapter(mockArea, mockOnChanged)
adapter.setOrigin('https://panel.example.com')

// Issue write 1 ('dark') and write 2 ('light') concurrently
adapter.setItem('theme', 'dark')
adapter.setItem('theme', 'light')
await withMutedError(async () => {
  await assert.rejects(
    () => adapter.flush(),
    err => /failure on first write/i.test(err.message),
  )
})

// Check that adapter in-memory value is 'light' (the failed 'dark' write did NOT overwrite 'light' with undefined/old value!)
assert.equal(adapter.getItem('theme'), 'light')

// Test second scenario: B succeeds, C fails -> B is in lastPersistedValues, C rolls back to B
areaCallCount = 2 // Op 1 (succeeds)
adapter.setItem('font', 'sans')
await adapter.flush()
assert.equal(adapter.getItem('font'), 'sans')

// Two flush callers awaiting the same failed operation must both observe the
// failure; one caller must not consume shared error state for the other.
const sharedFailureArea = {
  get: async () => ({}),
  set: async () => { throw new Error('Shared flush failure') },
  remove: async () => {},
}
const sharedFailureAdapter = new ChromeStorageAdapter(sharedFailureArea, mockOnChanged)
sharedFailureAdapter.setOrigin('https://panel.example.com')
sharedFailureAdapter.setItem('shared', 'value')
const flushOne = sharedFailureAdapter.flush()
const flushTwo = sharedFailureAdapter.flush()
const sharedFlushResults = await withMutedError(() => Promise.allSettled([flushOne, flushTwo]))
assert.deepEqual(sharedFlushResults.map(result => result.status), ['rejected', 'rejected'])

// Next write fails
mockArea.set = async () => {
  throw new Error('Simulated set failure for C')
}
adapter.setItem('font', 'serif') // Op 2 (fails)
await withMutedError(async () => {
  await assert.rejects(
    () => adapter.flush(),
    err => /Simulated set failure for C/i.test(err.message),
  )
})
// Font must roll back to 'sans' (last persisted value)
assert.equal(adapter.getItem('font'), 'sans')

console.log('Passed ChromeStorageAdapter Concurrent Write & Rollback Safety Tests.')

console.log('--- Running Two-Stage Deletion & Retry Queue Production Flow Tests ---')

// Setup widget instances and private storage
const widget1 = { id: 'clock.1', type: 'core.clock', version: 1, position: { column: 0, row: 0 }, size: { columns: 2, rows: 1 }, hidden: false, config: {} }
const widget2 = { id: 'notes.2', type: 'core.notes', version: 1, position: { column: 0, row: 1 }, size: { columns: 2, rows: 2 }, hidden: false, config: {} }

const initialPrefs = {
  clock: true,
  search: true,
  weather: true,
  trending: true,
  contentLayout: {
    schemaVersion: 1,
    widgets: [widget1, widget2],
  },
}

await saveExtensionWidgets(initialPrefs)

// Legacy/full-layout saves must not erase cleanup tombstones, and queued
// atomic updates must preserve IDs appended by another operation.
await updateExtensionWidgets(current => ({ ...current, pendingWidgetCleanupIds: ['old.cleanup'] }))
await saveExtensionWidgets({ ...initialPrefs, clock: false })
assert.deepEqual(readExtensionWidgets().pendingWidgetCleanupIds, ['old.cleanup'])
await Promise.all([
  updateExtensionWidgets(current => ({
    ...current,
    pendingWidgetCleanupIds: [...(current.pendingWidgetCleanupIds ?? []), 'new.cleanup'],
  })),
  updateExtensionWidgets(current => ({
    ...current,
    pendingWidgetCleanupIds: (current.pendingWidgetCleanupIds ?? []).filter(id => id !== 'old.cleanup'),
  })),
])
assert.deepEqual(readExtensionWidgets().pendingWidgetCleanupIds, ['new.cleanup'])
await updateExtensionWidgets(current => ({ ...current, ...initialPrefs, pendingWidgetCleanupIds: [] }))

// Simulate widget private storage in storage maps
memoryMap.set('PANEL_NEXT_WIDGET_V1.7:clock.1:9:user_pref', JSON.stringify({ format: '24h' }))
durableMap.set('PANEL_NEXT_WIDGET_V1.7:clock.1:9:user_pref', JSON.stringify({ format: '24h' }))
memoryMap.set('PANEL_NEXT_WIDGET_V1.7:notes.2:9:note_data', JSON.stringify({ text: 'Important Note' }))
durableMap.set('PANEL_NEXT_WIDGET_V1.7:notes.2:9:note_data', JSON.stringify({ text: 'Important Note' }))

// Scenario A: Stage 1 layout save FAILS -> UI restored, private storage unchanged
{
  flushShouldFail = true
  const instances = [widget1, widget2]
  const result = await withMutedError(async () => {
    return await removeExtensionWidgetFlow(instances, 'notes.2', [], initialPrefs)
  })

  assert.equal(result.success, false)
  assert.equal(result.stage, 'layout')
  assert.equal(result.updatedInstances.length, 2) // UI restored
  assert.equal(durableMap.has('PANEL_NEXT_WIDGET_V1.7:notes.2:9:note_data'), true)
  assert.equal(memoryMap.has('PANEL_NEXT_WIDGET_V1.7:notes.2:9:note_data'), true)
}

// Scenario B: Stage 1 layout save SUCCEEDS, Stage 2 storage cleanup SUCCEEDS
{
  flushShouldFail = false
  const instances = [widget1, widget2]
  const result = await removeExtensionWidgetFlow(instances, 'notes.2', [], initialPrefs)

  assert.equal(result.success, true)
  assert.equal(result.stage, 'done')
  assert.equal(result.storageCleanupFailed, false)
  assert.equal(result.updatedInstances.length, 1)
  assert.equal(result.updatedInstances[0].id, 'clock.1')

  // Storage for notes.2 is cleaned up; clock.1 is preserved
  assert.equal(durableMap.has('PANEL_NEXT_WIDGET_V1.7:notes.2:9:note_data'), false)
  assert.equal(durableMap.has('PANEL_NEXT_WIDGET_V1.7:clock.1:9:user_pref'), true)

  // pendingWidgetCleanupIds is empty
  const currentPrefs = readExtensionWidgets()
  assert.deepEqual(currentPrefs.pendingWidgetCleanupIds, [])
}

// Scenario C: Stage 1 layout save SUCCEEDS, Stage 2 storage cleanup FAILS -> enrolled in pendingWidgetCleanupIds
{
  // Reset initial state with widget1 and widget2
  await saveExtensionWidgets(initialPrefs)
  memoryMap.set('PANEL_NEXT_WIDGET_V1.7:notes.2:9:note_data', JSON.stringify({ text: 'To be deleted' }))
  durableMap.set('PANEL_NEXT_WIDGET_V1.7:notes.2:9:note_data', JSON.stringify({ text: 'To be deleted' }))

  // Mock clearWidgetStorage to fail during Stage 2
  const originalFlush = mockRuntime.storage.flush
  let callCount = 0
  mockRuntime.storage.flush = async () => {
    callCount++
    if (callCount === 1) {
      // Stage 1 layout save flush succeeds
      durableMap.clear()
      for (const [k, v] of memoryMap.entries()) durableMap.set(k, v)
      return
    }
    // Stage 2 storage cleanup flush fails
    throw new Error('IO Error during clearWidgetStorage flush')
  }

  const instances = [widget1, widget2]
  const result = await withMutedError(async () => {
    return await removeExtensionWidgetFlow(instances, 'notes.2', [], initialPrefs)
  })

  // Restore flush
  mockRuntime.storage.flush = originalFlush

  assert.equal(result.success, true) // Operation was established because layout was deleted
  assert.equal(result.stage, 'storage')
  assert.equal(result.storageCleanupFailed, true)
  assert.equal(result.updatedInstances.length, 1) // UI keeps the widget removed!

  // Layout in storage is indeed deleted
  const savedPrefs = JSON.parse(durableMap.get(EXTENSION_WIDGETS_KEY))
  assert.equal(savedPrefs.contentLayout.widgets.length, 1)
  // notes.2 was enqueued in pendingWidgetCleanupIds!
  assert.deepEqual(savedPrefs.pendingWidgetCleanupIds, ['notes.2'])

  // Simulation: Reboot/Startup or Online event triggers processPendingWidgetCleanups()
  const cleanedCount = await processPendingWidgetCleanups()
  assert.equal(cleanedCount, 1)

  // Private storage for notes.2 is now removed
  assert.equal(memoryMap.has('PANEL_NEXT_WIDGET_V1.7:notes.2:9:note_data'), false)
  // pendingWidgetCleanupIds is now cleared!
  const updatedPrefs = readExtensionWidgets()
  assert.deepEqual(updatedPrefs.pendingWidgetCleanupIds, [])
}

console.log('Passed Two-Stage Deletion & Retry Queue Production Flow Tests.')
console.log('✅ ALL Extension Persistence Unit Tests Passed!')
