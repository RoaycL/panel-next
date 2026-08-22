import { useAppStore, useAuthStore } from '@/store'
import { get as apiGet, HttpRequestError, post as apiPost } from '@/utils/request'
import type { Response } from '@/utils/request'
import type { WidgetContext } from './context'
import { useWidgetContext } from './context'
import { assertContextCapability } from './capabilities'
import {
  clearNetworkCachesForTesting,
  clearWidgetNetworkCache,
  clearWidgetNetworkState,
  deleteRateTimestamps,
  getCacheSizeForTesting,
  getRateTimestamps,
  getRateWindowCountForTesting,
  getRateWindowsKeys,
  getRateWindowsSizeForTesting,
  normalizeHeadersForCache,
  readNetworkCache,
  sanitizeHeaders,
  setRateTimestamps,
  stableSerialize,
  writeNetworkCache,
} from './networkState'

export {
  clearNetworkCachesForTesting,
  clearWidgetNetworkCache,
  clearWidgetNetworkState,
  getCacheSizeForTesting,
  getRateWindowCountForTesting,
  getRateWindowsSizeForTesting,
  normalizeHeadersForCache,
  sanitizeHeaders,
  stableSerialize,
}

// 向后兼容导出
export const sanitizeExternalHeaders = sanitizeHeaders

/**
 * 统一组件网络客户端：认证、超时、取消、重试、限流与缓存。
 *
 * - 相对路径（如 `/v1/widgets/trending`）：走项目请求层，自动携带登录态，内部接口重试时静默项目全局通知；
 * - 绝对 http(s) URL：直接请求外部资源，绝不附带项目凭据且强制 credentials: 'omit'；
 * - 严格过滤外部请求的敏感标头（authorization, token, cookie 等）；
 * - 仅重试传输层失败（网络中断/超时/5xx），业务错误（code!==0）与 4xx 不重试；
 * - 每实例每分钟最多 30 次网络传输（包括重试在内的每次实际网络请求均计数），超额停止重试；
 * - GET 结果支持 LRU 缓存，缓存命中不消耗限流额度。
 *
 * 必须声明 'network' 能力；脱离宿主上下文不可用。
 */
export class WidgetApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly retryable: boolean = false,
  ) {
    super(message)
    this.name = 'WidgetApiError'
  }
}

const DEFAULT_TIMEOUT_MS = 15_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 60_000
const MAX_RETRIES = 3
const WINDOW_REQUEST_LIMIT = 30
const WINDOW_MS = 60_000
const MAX_CACHE_TTL_MS = 86_400_000
const MAX_CACHE_KEY_LENGTH = 2048

export type UrlTarget =
  | { kind: 'internal'; path: string }
  | { kind: 'external'; url: string }

export function parseAndValidateUrl(url: string): UrlTarget {
  if (typeof url !== 'string' || !url.trim()) {
    throw new WidgetApiError('Request URL cannot be empty.', undefined, false)
  }
  const trimmed = url.trim()

  // 1. 严格区分项目接口：只允许单个 / 开头，拒绝 //evil.example 等协议相对地址
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) {
      throw new WidgetApiError(`Protocol-relative URL "${trimmed}" is forbidden.`, undefined, false)
    }
    // eslint-disable-next-line no-control-regex
    if (/[\\\u0000-\u001F\u007F]/.test(trimmed)) {
      throw new WidgetApiError(`Invalid internal path containing forbidden characters: "${trimmed}".`, undefined, false)
    }
    return { kind: 'internal', path: trimmed }
  }

  // 2. 外部地址：使用 new URL() 解析
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  }
  catch {
    throw new WidgetApiError(`Invalid or malformed URL: "${trimmed}".`, undefined, false)
  }

  // 只允许 http: 和 https:
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WidgetApiError(`Unsupported protocol "${parsed.protocol}" in URL: "${trimmed}". Only HTTP and HTTPS are allowed.`, undefined, false)
  }

  // 拒绝包含 username / password 的 URL
  if (parsed.username !== '' || parsed.password !== '') {
    throw new WidgetApiError(`URLs containing embedded credentials are forbidden: "${trimmed}".`, undefined, false)
  }

  return { kind: 'external', url: parsed.href }
}

export function stableCacheKey(
  instanceId: string,
  method: string,
  target: UrlTarget,
  data?: unknown,
  headers?: Record<string, string>,
  accountScope?: string,
  lang?: string,
): string | null {
  const normMethod = method.toUpperCase()
  const targetUrl = target.kind === 'internal' ? target.path : target.url
  const serializedData = data !== undefined ? stableSerialize(data) : ''
  if (data !== undefined && serializedData === null) {
    return null
  }
  const normHeaders = normalizeHeadersForCache(headers)

  let scope = ''
  if (target.kind === 'internal') {
    scope = `:${accountScope ?? 'guest'}:${lang ?? 'default'}`
  }

  const rawKey = `${instanceId}:${normMethod}:${targetUrl}:${serializedData}:${normHeaders}${scope}`
  if (rawKey.length > MAX_CACHE_KEY_LENGTH) {
    return null
  }
  return rawKey
}

function safeClone<T>(data: T): T {
  try {
    if (typeof structuredClone === 'function')
      return structuredClone(data)
    return JSON.parse(JSON.stringify(data))
  }
  catch {
    return data
  }
}

export function readCache<T>(key: string): T | undefined {
  const entry = readNetworkCache(key)
  if (!entry)
    return undefined
  return safeClone(entry.data as T)
}

export function writeCache(key: string, value: unknown, ttlMs: number): void {
  const clampedTtl = Math.min(Math.max(0, ttlMs), MAX_CACHE_TTL_MS)
  if (clampedTtl <= 0)
    return
  writeNetworkCache(key, safeClone(value), clampedTtl)
}

export function enforceRateLimit(instanceId: string, now = Date.now()): void {
  // 清理过期时间戳
  const windowLimit = now - WINDOW_MS

  for (const id of getRateWindowsKeys()) {
    const timestamps = getRateTimestamps(id).filter(t => t > windowLimit)
    if (timestamps.length) {
      setRateTimestamps(id, timestamps)
    }
    else {
      deleteRateTimestamps(id)
    }
  }

  const current = getRateTimestamps(instanceId).filter(t => t > windowLimit)
  if (current.length >= WINDOW_REQUEST_LIMIT) {
    throw new WidgetApiError(
      `Widget "${instanceId}" exceeded the local rate limit (${WINDOW_REQUEST_LIMIT}/${WINDOW_MS / 1000}s).`,
      1600,
      false,
    )
  }

  current.push(now)
  setRateTimestamps(instanceId, current)
}

export function isRetryableTransmissionError(error: unknown, callerSignal?: AbortSignal): boolean {
  if (callerSignal?.aborted)
    return false

  if (error instanceof HttpRequestError) {
    return error.retryable
  }

  if (error instanceof WidgetApiError) {
    return error.retryable
  }

  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return true
  }

  if (error instanceof Error && error.name === 'TimeoutError') {
    return true
  }

  if (error instanceof TypeError) {
    return true
  }

  return false
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface WidgetRequestOptions {
  method?: 'GET' | 'POST'
  /** 请求体；仅 POST。相对路径时序列化后交给项目请求层 */
  data?: unknown
  /** 默认 15000ms */
  timeoutMs?: number
  /** 传输层失败额外重试次数，默认 1，最大 3 */
  retries?: number
  /** GET 内存缓存时长；不传则不缓存 */
  cacheTtlMs?: number
  headers?: Record<string, string>
  /** 外部取消信号；超时与外部取消都会中止底层请求 */
  signal?: AbortSignal
}

export function useWidgetNetwork() {
  const context: WidgetContext | null = useWidgetContext()
  assertContextCapability(context, 'network')
  const instanceId = context.instanceId

  let authStore: ReturnType<typeof useAuthStore> | null = null
  let appStore: ReturnType<typeof useAppStore> | null = null
  try {
    authStore = useAuthStore()
    appStore = useAppStore()
  }
  catch {}

  async function execute<T>(
    target: UrlTarget,
    method: 'GET' | 'POST',
    options: WidgetRequestOptions,
    sanitizedHeaders: Record<string, string> | undefined,
    controller: AbortController,
  ): Promise<Response<T>> {
    if (target.kind === 'external') {
      let body: string | undefined
      let headers = sanitizedHeaders
      if (method === 'POST') {
        try {
          body = JSON.stringify(options.data ?? {})
        }
        catch {
          throw new WidgetApiError('External request body must be JSON-serializable.', 400, false)
        }
        headers = { 'content-type': 'application/json', ...sanitizedHeaders }
      }
      const response = await fetch(target.url, {
        method,
        headers,
        body,
        credentials: 'omit',
        signal: controller.signal,
      })

      if (!response.ok) {
        const retryable = response.status >= 500
        throw new WidgetApiError(`External request failed with HTTP ${response.status}.`, response.status, retryable)
      }

      let parsed: T
      try {
        parsed = await response.json() as T
      }
      catch {
        throw new WidgetApiError('Failed to parse external response as JSON.', response.status, false)
      }
      return { code: 0, msg: '', data: parsed }
    }

    const send = method === 'POST' ? apiPost : apiGet
    return await send<T>({
      url: target.path,
      data: options.data,
      headers: options.headers,
      signal: controller.signal,
      silentNetworkError: true, // 组件统一处理错误，避免重试产生多条全局提示
    })
  }

  async function request<T = unknown>(url: string, options: WidgetRequestOptions = {}): Promise<T> {
    const target = parseAndValidateUrl(url)

    // 严格运行时校验 HTTP method
    const suppliedMethod: unknown = options.method ?? 'GET'
    if (typeof suppliedMethod !== 'string') {
      throw new WidgetApiError('HTTP method must be a string. Only GET and POST are supported.', 400, false)
    }
    const rawMethod = suppliedMethod.trim().toUpperCase()
    if (rawMethod !== 'GET' && rawMethod !== 'POST') {
      throw new WidgetApiError(`Unsupported HTTP method "${options.method}". Only GET and POST are supported.`, 400, false)
    }
    const method = rawMethod as 'GET' | 'POST'

    const rawTtl = options.cacheTtlMs
    const cacheable = method === 'GET' && typeof rawTtl === 'number' && Number.isFinite(rawTtl) && rawTtl > 0

    const sanitizedHeaders = target.kind === 'external' ? sanitizeHeaders(options.headers) : options.headers
    const cacheHeaders = sanitizeHeaders(options.headers)
    const accountScope = authStore?.userInfo?.id ? String(authStore.userInfo.id) : (authStore?.token ? 'auth-user' : 'guest')
    const lang = appStore?.language

    const cacheKey = cacheable ? stableCacheKey(instanceId, method, target, options.data, cacheHeaders, accountScope, lang) : null

    if (cacheable && cacheKey !== null) {
      const cached = readCache<T>(cacheKey)
      if (cached !== undefined)
        return cached
    }

    const rawRetries = options.retries
    const retries = typeof rawRetries === 'number' && Number.isFinite(rawRetries)
      ? Math.max(0, Math.min(Math.floor(rawRetries), MAX_RETRIES))
      : 1
    const rawTimeout = options.timeoutMs
    const timeoutMs = typeof rawTimeout === 'number' && Number.isFinite(rawTimeout)
      ? Math.max(MIN_TIMEOUT_MS, Math.min(rawTimeout, MAX_TIMEOUT_MS))
      : DEFAULT_TIMEOUT_MS

    for (let attempt = 0; ; attempt++) {
      // 每次实际发起网络传输（包括初次和重试）均消耗限流额度；达限额立即抛出 1600 并终止重试
      enforceRateLimit(instanceId)

      const controller = new AbortController()
      let timeoutTriggered = false
      const timer = setTimeout(() => {
        timeoutTriggered = true
        controller.abort(new DOMException('Request timed out.', 'TimeoutError'))
      }, timeoutMs)

      let callerAbortListener: (() => void) | undefined
      if (options.signal) {
        if (options.signal.aborted) {
          clearTimeout(timer)
          throw options.signal.reason ?? new DOMException('User aborted request.', 'AbortError')
        }
        callerAbortListener = () => {
          controller.abort(options.signal?.reason ?? new DOMException('User aborted request.', 'AbortError'))
        }
        options.signal.addEventListener('abort', callerAbortListener, { once: true })
      }

      try {
        const result = await execute<T>(target, method, options, sanitizedHeaders, controller)
        if (result.code !== 0) {
          throw new WidgetApiError(result.msg || `Internal API returned business code ${result.code}.`, result.code, false)
        }

        if (cacheable && cacheKey !== null) {
          writeCache(cacheKey, result.data, rawTtl!)
        }
        return result.data
      }
      catch (error) {
        if (options.signal?.aborted) {
          throw options.signal.reason ?? error
        }
        let classifiedError: Error
        if (timeoutTriggered) {
          classifiedError = new WidgetApiError(`Request timed out after ${timeoutMs}ms.`, 408, true)
        }
        else if (error instanceof WidgetApiError) {
          classifiedError = error
        }
        else if (error instanceof HttpRequestError) {
          classifiedError = new WidgetApiError(error.message, error.status, error.retryable)
        }
        else if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          classifiedError = new WidgetApiError(error instanceof Error ? error.message : String(error), undefined, true)
        }
        else if (error instanceof Error && error.name === 'TimeoutError') {
          classifiedError = new WidgetApiError(error.message, 408, true)
        }
        else if (error instanceof TypeError) {
          classifiedError = new WidgetApiError(error.message, undefined, true)
        }
        else if (error instanceof DOMException) {
          classifiedError = new WidgetApiError(error.message, undefined, false)
        }
        else {
          classifiedError = error instanceof Error ? error : new Error(String(error))
        }

        const canRetry = attempt < retries && isRetryableTransmissionError(classifiedError, options.signal)
        if (!canRetry) {
          throw classifiedError
        }

        const backoffMs = Math.min(300 * 2 ** attempt, 2000)
        await delay(backoffMs, options.signal)
      }
      finally {
        clearTimeout(timer)
        if (options.signal && callerAbortListener) {
          options.signal.removeEventListener('abort', callerAbortListener)
        }
      }
    }
  }

  return {
    request,
    get: <T = unknown>(url: string, options?: Omit<WidgetRequestOptions, 'method'>) =>
      request<T>(url, { ...options, method: 'GET' }),
    post: <T = unknown>(url: string, options?: Omit<WidgetRequestOptions, 'method'>) =>
      request<T>(url, { ...options, method: 'POST' }),
  }
}
