import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

function cleanImports(src) {
  return src.replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"][^'"]+['"];?/g, '')
}

const requestSource = cleanImports(fs.readFileSync(new URL('../src/utils/request/index.ts', import.meta.url), 'utf8'))

const mockAxiosGetCalls = []
const mockAxiosPostCalls = []
globalThis.mockAxiosGetCalls = mockAxiosGetCalls
globalThis.mockAxiosPostCalls = mockAxiosPostCalls

const bundlePreamble = `
export function useAuthStore() {
  return {
    token: 'super-secret-project-jwt-token',
    authMode: 'web',
    refreshSession: async () => false,
    removeToken: () => {},
  }
}

export function useAppStore() {
  return {
    language: 'zh-CN',
  }
}

export function getRuntime() {
  return {
    kind: 'web',
    getApiBaseUrl: () => 'https://panel.internal/api',
  }
}

export function t(key) {
  return key
}

export const message = {
  warning: () => {},
  error: () => {},
}

export function apiRespErrMsg() {
  return true
}

export const router = {
  push: () => {},
}

const axios = {
  isAxiosError: () => false,
  isCancel: () => false,
}

const request = {
  get: async (url, config) => {
    if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('\\\\')) {
      throw new Error('Forbidden request to external or invalid URL in project Axios layer.')
    }
    globalThis.mockAxiosGetCalls.push({ url, config })
    return {
      status: 200,
      headers: {},
      data: { code: 0, msg: 'ok', data: { url, sentHeaders: config.headers } },
    }
  },
  post: async (url, data, config) => {
    if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('\\\\')) {
      throw new Error('Forbidden request to external or invalid URL in project Axios layer.')
    }
    globalThis.mockAxiosPostCalls.push({ url, data, config })
    return {
      status: 200,
      headers: {},
      data: { code: 0, msg: 'ok', data: { url, data, sentHeaders: config.headers } },
    }
  },
}
`

const bundleCode = `${bundlePreamble}\n${requestSource}`

const transpiled = ts.transpileModule(bundleCode, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'request-security-bundle.ts',
  reportDiagnostics: true,
})
if (transpiled.diagnostics?.length) {
  const msgs = transpiled.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  throw new Error(`Failed to transpile request security bundle:\n${msgs.join('\n')}`)
}

const encoded = Buffer.from(transpiled.outputText).toString('base64')
const mod = await import(`data:text/javascript;base64,${encoded}`)

const {
  isInternalApiPath,
  assertInternalApiPath,
  HttpRequestError,
  get: apiGet,
  post: apiPost,
} = mod

console.log('--- Running Project Request Layer URL Validation & Defense Tests ---')

// 1. Valid internal paths
assert.equal(isInternalApiPath('/v1/widgets/weather'), true)
assert.equal(isInternalApiPath('/api/user/info?tab=1'), true)
assert.doesNotThrow(() => assertInternalApiPath('/v1/test'))

// 2. Protocol-relative URLs MUST be rejected
assert.equal(isInternalApiPath('//evil.example/test'), false)
assert.throws(() => assertInternalApiPath('//evil.example/test'), err => err instanceof HttpRequestError)

// 3. Absolute HTTP(S) URLs MUST be rejected
assert.equal(isInternalApiPath('https://evil.example/test'), false)
assert.equal(isInternalApiPath('http://evil.example/test'), false)
assert.throws(() => assertInternalApiPath('https://evil.example/test'), err => err instanceof HttpRequestError)
assert.throws(() => assertInternalApiPath('http://evil.example/test'), err => err instanceof HttpRequestError)

// 4. Other protocols and invalid formats MUST be rejected
assert.equal(isInternalApiPath('javascript:alert(1)'), false)
assert.equal(isInternalApiPath('data:text/html,bad'), false)
assert.equal(isInternalApiPath('/api\\evil/path'), false) // Backslash rejected
assert.equal(isInternalApiPath('/api\u0000nullbyte'), false) // Control character rejected
assert.equal(isInternalApiPath('relative/path'), false)
assert.equal(isInternalApiPath(''), false)
assert.equal(isInternalApiPath(null), false)
assert.equal(isInternalApiPath(undefined), false)

console.log('Passed URL validation and path defense checks.')

console.log('--- Running Project Request Layer Header Immutability & Auth Leak Tests ---')

mockAxiosGetCalls.length = 0
mockAxiosPostCalls.length = 0

// 5. Valid internal request: enters Axios and receives token
const callerHeaders = { 'X-Custom-Header': 'my-client-header' }
const originalHeadersSnapshot = { ...callerHeaders }

const response = await apiGet({
  url: '/v1/test',
  headers: callerHeaders,
})

assert.equal(response.code, 0)
assert.equal(mockAxiosGetCalls.length, 1)
assert.equal(mockAxiosGetCalls[0].url, '/v1/test')
assert.equal(mockAxiosGetCalls[0].config.headers.token, 'super-secret-project-jwt-token')
assert.equal(mockAxiosGetCalls[0].config.headers['X-Custom-Header'], 'my-client-header')

// CRITICAL ASSERTION: Caller's headers object MUST NOT be mutated!
assert.deepEqual(callerHeaders, originalHeadersSnapshot)
assert.equal(callerHeaders.token, undefined)
assert.equal(callerHeaders.lang, undefined)

// 6. External or dangerous requests MUST NOT enter Axios and MUST NOT leak headers
const rejectedUrls = [
  'https://evil.example/api',
  'http://evil.example/api',
  '//evil.example/steal',
  'javascript:steal()',
  '/path\\with\\backslash',
  '/path\u0001with\u0002control',
  'invalid-no-leading-slash',
]

for (const badUrl of rejectedUrls) {
  const currentGetCallsCount = mockAxiosGetCalls.length
  const currentPostCallsCount = mockAxiosPostCalls.length
  const testHeaders = { 'X-Sensitive': 'keep-safe' }

  await assert.rejects(
    async () => apiGet({ url: badUrl, headers: testHeaders }),
    err => err instanceof HttpRequestError && err.status === 400,
    `Expected URL "${badUrl}" to be rejected by project request layer`,
  )

  await assert.rejects(
    async () => apiPost({ url: badUrl, headers: testHeaders }),
    err => err instanceof HttpRequestError && err.status === 400,
    `Expected URL "${badUrl}" to be rejected by project request layer (POST)`,
  )

  // Axios MUST NOT have been called
  assert.equal(mockAxiosGetCalls.length, currentGetCallsCount)
  assert.equal(mockAxiosPostCalls.length, currentPostCallsCount)

  // testHeaders MUST NOT be mutated
  assert.equal(testHeaders.token, undefined)
  assert.deepEqual(testHeaders, { 'X-Sensitive': 'keep-safe' })
}

console.log('Passed Header Immutability & Credential Leak Prevention Tests.')
console.log('✅ ALL Project Request Security Tests Passed!')
