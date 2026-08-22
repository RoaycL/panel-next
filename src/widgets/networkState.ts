/**
 * Widget 网络缓存与限流状态管理（独立中立模块，不依赖 Pinia / Auth Store 以打破循环依赖）。
 */

export interface CachedResponse {
  data: unknown
  expiresAt: number
}

// 全局内存缓存表
const responseCache = new Map<string, CachedResponse>()
const MAX_CACHE_ENTRIES = 64
const NETWORK_STATE_MAX_TTL_MS = 86_400_000

// 滑动时间窗口限流表: instanceId -> timestamps[]
const rateWindows = new Map<string, number[]>()

export const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'cookie2',
  'token',
])

/**
 * 判断是否为普通键值对对象（Plain Object），排除 Date、Map、Set、URL、RegExp 及自定义类实例。
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object')
    return false
  const proto = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

/**
 * 递归稳定序列化：
 * - 仅接受 JSON 基元（null, boolean, finite number, string）、数组及 Plain Object
 * - 对象各层键统一字典序排序
 * - 数组保持原始元素顺序
 * - 遇到 Date、URL、Map、Set、RegExp、函数、Symbol、BigInt、NaN/Infinity 或循环引用直接返回 null，禁用缓存
 */
export function stableSerialize(value: unknown, seen = new WeakSet<object>()): string | null {
  if (value === null)
    return 'null'
  if (typeof value === 'boolean')
    return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      return null
    return JSON.stringify(value)
  }
  if (typeof value === 'string')
    return JSON.stringify(value)
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function' || value === undefined)
    return null

  if (typeof value === 'object') {
    if (seen.has(value))
      return null // 循环引用检测
    seen.add(value)
    try {
      if (Array.isArray(value)) {
        const items: string[] = []
        for (const item of value) {
          const serialized = stableSerialize(item, seen)
          if (serialized === null)
            return null
          items.push(serialized)
        }
        return `[${items.join(',')}]`
      }

      if (!isPlainObject(value)) {
        // 拒绝 Date, URL, Map, Set 等非普通对象，防止碰撞
        return null
      }

      const keys = Object.keys(value).sort()
      const pairs: string[] = []
      for (const key of keys) {
        const propVal = value[key]
        if (propVal === undefined)
          continue
        const serialized = stableSerialize(propVal, seen)
        if (serialized === null)
          return null
        pairs.push(`${JSON.stringify(key)}:${serialized}`)
      }
      return `{${pairs.join(',')}}`
    }
    catch {
      // Proxies/getters are allowed as request input at runtime, but a cache
      // key must never make the request itself fail.
      return null
    }
    finally {
      // Track only the active recursion stack. Repeated, non-cyclic object
      // references have the same JSON meaning and are safe to serialize.
      seen.delete(value)
    }
  }

  return null
}

/**
 * 敏感请求头过滤（内部和外部请求通用）
 */
export function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers)
    return undefined
  const clean: Record<string, string> = {}
  for (const [rawKey, value] of Object.entries(headers)) {
    const key = rawKey.trim().toLowerCase()
    if (!SENSITIVE_HEADER_KEYS.has(key)) {
      clean[key] = String(value)
    }
  }
  return clean
}

export function normalizeHeadersForCache(headers?: Record<string, string>): string {
  if (!headers)
    return ''
  const sanitized = sanitizeHeaders(headers)
  if (!sanitized)
    return ''
  const entries = Object.entries(sanitized)
    .sort((a, b) => a[0].localeCompare(b[0]))
  return JSON.stringify(entries)
}

export function readNetworkCache(key: string): CachedResponse | undefined {
  const cached = responseCache.get(key)
  if (!cached)
    return undefined
  if (Date.now() > cached.expiresAt) {
    responseCache.delete(key)
    return undefined
  }
  // Refresh insertion order on every hit to maintain a strict LRU.
  responseCache.delete(key)
  responseCache.set(key, cached)
  return cached
}

export function writeNetworkCache(key: string, data: unknown, ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0)
    return
  const now = Date.now()
  for (const [cacheKey, entry] of responseCache) {
    if (entry.expiresAt <= now)
      responseCache.delete(cacheKey)
  }
  if (responseCache.has(key)) {
    responseCache.delete(key)
  }
  else if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value
    if (oldestKey !== undefined)
      responseCache.delete(oldestKey)
  }
  responseCache.set(key, {
    data,
    expiresAt: now + Math.min(ttlMs, NETWORK_STATE_MAX_TTL_MS),
  })
}

/**
 * 清理 Widget 网络状态（同时清理响应缓存和限流窗口），供退出登录、切换账号时调用。
 */
export function clearWidgetNetworkState(): void {
  responseCache.clear()
  rateWindows.clear()
}

/**
 * 向后兼容别名
 */
export const clearWidgetNetworkCache = clearWidgetNetworkState

// 限流窗口管理
export function getRateTimestamps(instanceId: string): number[] {
  return rateWindows.get(instanceId) ?? []
}

export function setRateTimestamps(instanceId: string, timestamps: number[]): void {
  rateWindows.set(instanceId, timestamps)
}

export function deleteRateTimestamps(instanceId: string): void {
  rateWindows.delete(instanceId)
}

export function getRateWindowsKeys(): string[] {
  return Array.from(rateWindows.keys())
}

// 供单元测试查看状态
export function getCacheSizeForTesting(): number {
  return responseCache.size
}

export function getRateWindowsSizeForTesting(): number {
  return rateWindows.size
}

export function getRateWindowCountForTesting(instanceId: string): number {
  return (rateWindows.get(instanceId) ?? []).length
}

export function clearNetworkCachesForTesting(): void {
  clearWidgetNetworkState()
}
