import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

function cleanImports(src) {
  return src.replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"][^'"]+['"];?/g, '')
}

const networkStateSource = cleanImports(fs.readFileSync(new URL('../src/widgets/networkState.ts', import.meta.url), 'utf8'))
const capabilitiesSource = cleanImports(fs.readFileSync(new URL('../src/widgets/capabilities.ts', import.meta.url), 'utf8'))
const networkSource = cleanImports(fs.readFileSync(new URL('../src/widgets/network.ts', import.meta.url), 'utf8'))

const mockProjectRequestCalls = []
const mockFetchCalls = []
globalThis.mockProjectRequestCalls = mockProjectRequestCalls
globalThis.mockFetchCalls = mockFetchCalls
globalThis.mockFetchHandler = null
globalThis.mockProjectRequestHandler = null
globalThis.currentAuthUser = { id: 1001 }
globalThis.currentAuthToken = 'token-user-1001'
globalThis.currentLanguage = 'zh-CN'

const bundlePreamble = `
export class HttpRequestError extends Error {
  constructor(message, retryable, status) {
    super(message)
    this.name = 'HttpRequestError'
    this.retryable = retryable
    this.status = status
  }
}

export function useAuthStore() {
  return {
    token: globalThis.currentAuthToken,
    userInfo: globalThis.currentAuthUser,
  }
}

export function useAppStore() {
  return {
    language: globalThis.currentLanguage,
  }
}

export const mockProjectRequest = {
  get: async (options) => {
    globalThis.mockProjectRequestCalls.push({ method: 'GET', ...options })
    if (globalThis.mockProjectRequestHandler) {
      return globalThis.mockProjectRequestHandler({ method: 'GET', ...options })
    }
    return { code: 0, msg: '', data: { url: options.url, projectAuth: 'Bearer token123' } }
  },
  post: async (options) => {
    globalThis.mockProjectRequestCalls.push({ method: 'POST', ...options })
    if (globalThis.mockProjectRequestHandler) {
      return globalThis.mockProjectRequestHandler({ method: 'POST', ...options })
    }
    return { code: 0, msg: '', data: { url: options.url, projectAuth: 'Bearer token123' } }
  }
}
const apiGet = mockProjectRequest.get
const apiPost = mockProjectRequest.post

export function useWidgetContext() {
  return globalThis.currentMockContext
}
`

const bundleCode = [
  bundlePreamble,
  networkStateSource,
  capabilitiesSource,
  networkSource,
].join('\n')

const transpiled = ts.transpileModule(bundleCode, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'widget-network-bundle.ts',
  reportDiagnostics: true,
})
if (transpiled.diagnostics?.length) {
  const msgs = transpiled.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  throw new Error(`Failed to transpile network bundle:\n${msgs.join('\n')}`)
}

// Injected test hooks
globalThis.currentMockContext = null

// Setup mock fetch on globalThis
globalThis.fetch = async (url, init) => {
  mockFetchCalls.push({ url, init })
  if (globalThis.mockFetchHandler) {
    return globalThis.mockFetchHandler(url, init)
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ external: true, url }),
  }
}

const encoded = Buffer.from(transpiled.outputText).toString('base64')
const mod = await import(`data:text/javascript;base64,${encoded}`)

const {
  HttpRequestError,
  WidgetApiError,
  parseAndValidateUrl,
  sanitizeHeaders,
  sanitizeExternalHeaders,
  stableSerialize,
  stableCacheKey,
  readCache,
  writeCache,
  clearWidgetNetworkState,
  clearWidgetNetworkCache,
  clearNetworkCachesForTesting,
  getCacheSizeForTesting,
  getRateWindowCountForTesting,
  getRateWindowsSizeForTesting,
  enforceRateLimit,
  isRetryableTransmissionError,
  useWidgetNetwork,
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

console.log('--- Running Network URL Validation & Credentials Tests ---')

// 1.1 Project internal endpoints
assert.deepEqual(parseAndValidateUrl('/v1/widgets/weather'), { kind: 'internal', path: '/v1/widgets/weather' })
assert.deepEqual(parseAndValidateUrl('/api/test?query=1'), { kind: 'internal', path: '/api/test?query=1' })

// 1.2 External endpoints
assert.deepEqual(parseAndValidateUrl('https://api.weather.com/v1'), { kind: 'external', url: 'https://api.weather.com/v1' })
assert.deepEqual(parseAndValidateUrl('http://insecure.example.com/data'), { kind: 'external', url: 'http://insecure.example.com/data' })

// 1.3 Rejected dangerous URLs
assert.throws(() => parseAndValidateUrl('//evil.example/path'), err => err instanceof WidgetApiError)
assert.throws(() => parseAndValidateUrl('ftp://example.com'), err => err instanceof WidgetApiError)
assert.throws(() => parseAndValidateUrl('https://user:pass@evil.example'), err => err instanceof WidgetApiError)
assert.throws(() => parseAndValidateUrl('javascript:alert(1)'), err => err instanceof WidgetApiError)
assert.throws(() => parseAndValidateUrl(''), err => err instanceof WidgetApiError)

console.log('Passed URL validation and rejection checks.')

console.log('--- Running Recursive Stable Serialization & Non-Plain-Object Collision Tests ---')

// 2.1 Nested objects: different values produce distinct serialized keys
const key1 = stableSerialize({ q: { a: 1 } })
const key2 = stableSerialize({ q: { a: 2 } })
const key3 = stableSerialize({ q: { b: 3 } })
assert.notEqual(key1, key2)
assert.notEqual(key1, key3)
assert.notEqual(key2, key3)

// 2.2 Object key ordering independence
const objA = { b: 2, a: 1, c: { z: 9, y: 8 } }
const objB = { a: 1, c: { y: 8, z: 9 }, b: 2 }
assert.equal(stableSerialize(objA), stableSerialize(objB))

// 2.3 Array ordering preservation
assert.notEqual(stableSerialize([1, 2]), stableSerialize([2, 1]))

// 2.4 Non-serializable / Circular references / Non-plain objects safely return null (skip caching, no collision)
const circ = { name: 'circular' }
circ.self = circ
assert.equal(stableSerialize(circ), null)
assert.equal(stableSerialize({ val: Number.NaN }), null)
assert.equal(stableSerialize({ val: Number.POSITIVE_INFINITY }), null)
assert.equal(stableSerialize({ val: 42n }), null)

// Date, RegExp, Map, Set, URL return null to prevent collision into {}
assert.equal(stableSerialize(new Date()), null)
assert.equal(stableSerialize(new URL('https://example.com')), null)
assert.equal(stableSerialize(new Map([['a', 1]])), null)
assert.equal(stableSerialize(new Set([1, 2])), null)
assert.equal(stableSerialize(/test/i), null)

// Repeated references are not cycles and should keep their JSON meaning.
const shared = { value: 1 }
assert.equal(stableSerialize({ a: shared, b: shared }), '{"a":{"value":1},"b":{"value":1}}')

// A throwing getter/proxy must only disable caching, never fail the request.
const throwingGetter = {}
Object.defineProperty(throwingGetter, 'value', { enumerable: true, get: () => { throw new Error('getter failed') } })
assert.equal(stableSerialize(throwingGetter), null)

console.log('Passed Recursive Stable Serialization Tests.')

console.log('--- Running Account Scope & Sensitive Header Scrubbing in Cache Tests ---')

// 3.1 Internal requests scope by account ID and language
const targetInternal = { kind: 'internal', path: '/v1/data' }
const cacheKeyUser1 = stableCacheKey('inst1', 'GET', targetInternal, null, undefined, 'user1001', 'zh-CN')
const cacheKeyUser2 = stableCacheKey('inst1', 'GET', targetInternal, null, undefined, 'user2002', 'zh-CN')
const cacheKeyUser1En = stableCacheKey('inst1', 'GET', targetInternal, null, undefined, 'user1001', 'en-US')

assert.notEqual(cacheKeyUser1, cacheKeyUser2)
assert.notEqual(cacheKeyUser1, cacheKeyUser1En)

// 3.2 Sensitive headers stripped from BOTH internal and external cache keys
const sensitiveHeaders = {
  'authorization': 'Bearer super-secret',
  'cookie': 'session=abc',
  'token': 'secret-jwt',
  'proxy-authorization': 'Basic secret',
  'cookie2': 'val',
  'x-custom': 'allow',
}
const sanitized = sanitizeHeaders(sensitiveHeaders)
assert.deepEqual(sanitized, { 'x-custom': 'allow' })

const cacheKeyWithSecret = stableCacheKey('inst1', 'GET', targetInternal, null, sanitized, 'user1001', 'zh-CN')
assert.equal(cacheKeyWithSecret.includes('super-secret'), false)
assert.equal(cacheKeyWithSecret.includes('secret-jwt'), false)
assert.deepEqual(sanitizeExternalHeaders(sensitiveHeaders), { 'x-custom': 'allow' })

// 3.3 Clear widget network state (clears both response cache and rate windows)
writeCache('test-key', { data: 123 }, 60_000)
enforceRateLimit('inst_clear_test')
assert.equal(readCache('test-key')?.data, 123)
assert.equal(getRateWindowCountForTesting('inst_clear_test'), 1)

clearWidgetNetworkCache()
assert.equal(readCache('test-key'), undefined)

enforceRateLimit('inst_clear_test2')
clearWidgetNetworkState()
assert.equal(getRateWindowCountForTesting('inst_clear_test2'), 0)

// Strict 64-entry LRU: a hit refreshes recency and the oldest untouched key
// is evicted on the next insertion.
for (let i = 0; i < 64; i++)
  writeCache(`lru-${i}`, i, 60_000)
assert.equal(getCacheSizeForTesting(), 64)
assert.equal(readCache('lru-0'), 0)
writeCache('lru-new', 65, 60_000)
assert.equal(getCacheSizeForTesting(), 64)
assert.equal(readCache('lru-0'), 0)
assert.equal(readCache('lru-1'), undefined)

console.log('Passed Account Scope & Header Sanitization Cache Tests.')

console.log('--- Running Rate Limit Transmission Counting & Cleanup Tests ---')

clearNetworkCachesForTesting()

// 4.1 Execute rate limit: 30 calls allowed, 31st throws 1600
for (let i = 0; i < 30; i++) {
  enforceRateLimit('inst_rate_test')
}
assert.throws(() => enforceRateLimit('inst_rate_test'), err => err instanceof WidgetApiError && err.code === 1600)

// 4.2 Stale window cleanup with simulated time advance
const now = Date.now()
enforceRateLimit('inst_old', now)
assert.equal(getRateWindowsSizeForTesting() >= 2, true)

// Advance 61 seconds: stale entries must be pruned
enforceRateLimit('inst_new', now + 61_000)
assert.equal(getRateWindowCountForTesting('inst_old'), 0) // Old window pruned!

console.log('Passed Rate Limit Counting and Expiration Cleanup Tests.')

console.log('--- Running Error Classification, Timeout & Retry Logic Tests ---')

// 5.1 Retryability classification
assert.equal(isRetryableTransmissionError(new TypeError('Failed to fetch')), true)
assert.equal(isRetryableTransmissionError(new DOMException('Timed out', 'TimeoutError')), true)
assert.equal(isRetryableTransmissionError(new HttpRequestError('Server 502', true, 502)), true)
assert.equal(isRetryableTransmissionError(new HttpRequestError('Client 400', false, 400)), false)
assert.equal(isRetryableTransmissionError(new WidgetApiError('Business 1001', 1001, false)), false)

// Caller aborted signal is NEVER retryable
const abortCtrl = new AbortController()
abortCtrl.abort()
assert.equal(isRetryableTransmissionError(new DOMException('Aborted', 'AbortError'), abortCtrl.signal), false)

console.log('Passed Error Classification Tests.')

console.log('--- Running useWidgetNetwork Lifecycle, Method Validation & Retry Transmissions Tests ---')

// 6.1 Strict runtime HTTP Method validation (rejects DELETE, PUT, etc.)
globalThis.currentMockContext = {
  instanceId: 'inst_biz',
  type: 'core.weather',
  capabilities: ['network'],
  config: {},
  surface: 'web',
}

const networkClient = useWidgetNetwork()

await withMutedError(async () => {
  await assert.rejects(
    () => networkClient.request('/v1/test', { method: 'DELETE' }),
    err => err instanceof WidgetApiError && err.code === 400 && /Unsupported HTTP method/i.test(err.message),
  )
})

await assert.rejects(
  () => networkClient.request('/v1/test', { method: 42 }),
  err => err instanceof WidgetApiError && err.code === 400 && /must be a string/i.test(err.message),
)

// 6.2 Non-zero business code does NOT retry (fails on first attempt)
clearNetworkCachesForTesting()
mockProjectRequestCalls.length = 0

let projectCallCount = 0
globalThis.mockProjectRequestHandler = () => {
  projectCallCount++
  return { code: 1002, msg: 'Invalid business param', data: null }
}

await withMutedError(async () => {
  await assert.rejects(
    () => networkClient.request('/v1/biz/test', { retries: 3 }),
    err => err instanceof WidgetApiError && err.code === 1002,
  )
})

// Business error must NOT retry!
assert.equal(projectCallCount, 1)

// 6.3 Internal Timeout (with TimeoutError) retries and counts every transmission attempt
projectCallCount = 0
clearNetworkCachesForTesting()
globalThis.mockProjectRequestHandler = () => {
  projectCallCount++
  const timeoutErr = new Error('Request timeout')
  timeoutErr.name = 'TimeoutError'
  throw timeoutErr
}

await withMutedError(async () => {
  await assert.rejects(
    () => networkClient.request('/v1/timeout/test', { retries: 2, timeoutMs: 1000 }),
    err => err instanceof WidgetApiError && err.retryable,
  )
})

// 1 initial attempt + 2 retries = 3 transmission attempts
assert.equal(projectCallCount, 3)
// Rate window counted all 3 transmissions!
assert.equal(getRateWindowCountForTesting('inst_biz'), 3)

// 6.4 Caller Abort cancels immediately without retrying
projectCallCount = 0
const callerController = new AbortController()
globalThis.mockProjectRequestHandler = () => {
  projectCallCount++
  callerController.abort() // Caller cancels during first request
  throw new DOMException('User Aborted', 'AbortError')
}

await withMutedError(async () => {
  await assert.rejects(
    () => networkClient.request('/v1/abort/test', { retries: 3, signal: callerController.signal }),
  )
})

// Immediately stopped on caller abort without retrying
assert.equal(projectCallCount, 1)

// 6.5 Rate limit exhaustion during retries halts further attempts
projectCallCount = 0
clearNetworkCachesForTesting()
// Consume 29 rate limit quota points
for (let i = 0; i < 29; i++) {
  enforceRateLimit('inst_biz')
}

globalThis.mockProjectRequestHandler = () => {
  projectCallCount++
  const netErr = new TypeError('Failed to fetch')
  throw netErr
}

await withMutedError(async () => {
  await assert.rejects(
    () => networkClient.request('/v1/rate-exhaust/test', { retries: 3 }),
    err => err instanceof WidgetApiError && err.code === 1600,
  )
})

// Initial attempt was #30 (succeeded rate check), 1st retry was #31 (failed rate limit with 1600) -> aborted retries
assert.equal(projectCallCount, 1)

// 6.6 Cache hit does NOT consume rate limit quota
clearNetworkCachesForTesting()
projectCallCount = 0
globalThis.mockProjectRequestHandler = () => {
  projectCallCount++
  return { code: 0, msg: '', data: { weather: 'sunny' } }
}

const res1 = await networkClient.request('/v1/cache/test', { cacheTtlMs: 60_000 })
assert.deepEqual(res1, { weather: 'sunny' })
assert.equal(projectCallCount, 1)
assert.equal(getRateWindowCountForTesting('inst_biz'), 1)

// Second request: cache hit!
const res2 = await networkClient.request('/v1/cache/test', { cacheTtlMs: 60_000 })
assert.deepEqual(res2, { weather: 'sunny' })
assert.equal(projectCallCount, 1) // No new project request
assert.equal(getRateWindowCountForTesting('inst_biz'), 1) // Rate window quota NOT consumed!

// Non-transmission DOM errors and invalid JSON bodies are never retried.
clearNetworkCachesForTesting()
mockFetchCalls.length = 0
globalThis.mockFetchHandler = () => {
  throw new DOMException('Blocked by browser policy', 'SecurityError')
}
await assert.rejects(
  () => networkClient.request('https://external.example/data', { retries: 3 }),
  err => err instanceof WidgetApiError && err.retryable === false,
)
assert.equal(mockFetchCalls.length, 1)

mockFetchCalls.length = 0
await assert.rejects(
  () => networkClient.request('https://external.example/data', { method: 'POST', data: { invalid: 1n }, retries: 3 }),
  err => err instanceof WidgetApiError && err.retryable === false,
)
assert.equal(mockFetchCalls.length, 0)
globalThis.mockFetchHandler = null

console.log('Passed useWidgetNetwork Lifecycle, Method Validation, Silent Request & Retry Transmission Tests.')
console.log('✅ ALL Widget Network Unit Tests Passed!')
