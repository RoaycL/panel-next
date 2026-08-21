import type { RuntimeAdapter, StorageAdapter } from './types'
import { resolveHttpUrl } from './url'

const SERVER_ORIGIN_KEY = 'panelNext.runtime.serverOrigin'
const DATA_PREFIX = 'panelNext.data.'
const CONNECTION_TIMEOUT_MS = 8000

interface ChromeStorageArea {
  get: (keys?: null | string | string[]) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
  remove: (keys: string | string[]) => Promise<void>
}

interface ChromeStorageChange {
  newValue?: unknown
}

interface ChromeRuntimeApi {
  storage: {
    local: ChromeStorageArea
    onChanged: {
      addListener: (callback: (changes: Record<string, ChromeStorageChange>, areaName: string) => void) => void
    }
  }
  permissions: {
    contains: (permissions: { origins: string[] }) => Promise<boolean>
    request: (permissions: { origins: string[] }) => Promise<boolean>
    remove: (permissions: { origins: string[] }) => Promise<boolean>
  }
}

function getChromeApi(): ChromeRuntimeApi {
  const api = (globalThis as typeof globalThis & { chrome?: ChromeRuntimeApi }).chrome
  if (!api?.storage?.local || !api.storage.onChanged || !api.permissions)
    throw new Error('Chrome extension APIs are unavailable. Load the built package as an extension.')
  return api
}

function normalizeServerOrigin(input: string): string {
  const value = input.trim()
  if (!value)
    throw new Error('请输入服务器地址。')

  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('服务器地址格式无效，请包含 http:// 或 https://。')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('服务器地址仅支持 http:// 或 https://。')
  if (url.username || url.password)
    throw new Error('服务器地址不能包含用户名或密码。')
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error('请输入服务器 Origin，例如 https://panel.example.com，不要包含路径。')

  return url.origin
}

class ChromeStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, string>()
  private origin: string | null = null
  private writeQueue = Promise.resolve()
  private writeFailure: unknown = null

  constructor(private readonly area: ChromeStorageArea, onChanged: ChromeRuntimeApi['storage']['onChanged']) {
    onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local')
        return
      for (const [key, change] of Object.entries(changes)) {
        if (typeof change.newValue === 'string')
          this.values.set(key, change.newValue)
        else if (change.newValue === undefined)
          this.values.delete(key)
      }
    })
  }

  async preload() {
    const stored = await this.area.get(null)
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === 'string')
        this.values.set(key, value)
    }
  }

  async sync() {
    const stored = await this.area.get(null)
    this.values.clear()
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === 'string')
        this.values.set(key, value)
    }
  }

  readRuntimeValue(key: string) {
    return this.values.get(key) ?? null
  }

  async writeRuntimeValue(key: string, value: string) {
    this.values.set(key, value)
    await this.area.set({ [key]: value })
  }

  setOrigin(origin: string | null) {
    this.origin = origin
  }

  private scopedKey(key: string) {
    if (!this.origin)
      return null
    return `${DATA_PREFIX}${encodeURIComponent(this.origin)}.${key}`
  }

  private enqueue(operation: () => Promise<void>) {
    this.writeQueue = this.writeQueue.then(operation).catch((error) => {
      this.writeFailure = error
      console.error('Failed to persist extension storage.', error)
    })
  }

  getItem(key: string) {
    const scopedKey = this.scopedKey(key)
    return scopedKey ? this.values.get(scopedKey) ?? null : null
  }

  setItem(key: string, value: string) {
    const scopedKey = this.scopedKey(key)
    if (!scopedKey)
      return
    this.values.set(scopedKey, value)
    this.enqueue(() => this.area.set({ [scopedKey]: value }))
  }

  removeItem(key: string) {
    const scopedKey = this.scopedKey(key)
    if (!scopedKey)
      return
    this.values.delete(scopedKey)
    this.enqueue(() => this.area.remove(scopedKey))
  }

  clear() {
    if (!this.origin)
      return
    const prefix = `${DATA_PREFIX}${encodeURIComponent(this.origin)}.`
    const keys = [...this.values.keys()].filter(key => key.startsWith(prefix))
    keys.forEach(key => this.values.delete(key))
    if (keys.length)
      this.enqueue(() => this.area.remove(keys))
  }

  async flush() {
    await this.writeQueue
    if (this.writeFailure) {
      const failure = this.writeFailure
      this.writeFailure = null
      throw failure
    }
  }
}

async function validateServer(origin: string) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS)
  try {
    const response = await fetch(`${origin}/api/openness/loginConfig`, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
    if (!response.ok)
      throw new Error(`服务器返回 HTTP ${response.status}。`)

    const payload = await response.json() as {
      code?: unknown
      data?: {
        loginCaptcha?: unknown
        register?: unknown
      }
    }
    const register = payload.data?.register
    const hasCompatibleRegisterSetting = typeof register === 'boolean'
      || (typeof register === 'object' && register !== null && typeof (register as { openRegister?: unknown }).openRegister === 'boolean')
    if (payload.code !== 0 || typeof payload.data?.loginCaptcha !== 'boolean' || !hasCompatibleRegisterSetting)
      throw new Error('目标地址不是兼容的 Panel Next / Sun-Panel 服务。')
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw new Error('连接服务器超时，请检查地址和网络。')
    if (error instanceof Error)
      throw error
    throw new Error('无法连接服务器。')
  }
  finally {
    window.clearTimeout(timeout)
  }
}

export function createExtensionRuntime(): RuntimeAdapter {
  const chromeApi = getChromeApi()
  const storage = new ChromeStorageAdapter(chromeApi.storage.local, chromeApi.storage.onChanged)
  let serverOrigin: string | null = null

  return {
    kind: 'extension',
    storage,
    async ready() {
      await storage.preload()
      const storedOrigin = storage.readRuntimeValue(SERVER_ORIGIN_KEY)
      if (storedOrigin) {
        try {
          serverOrigin = normalizeServerOrigin(storedOrigin)
        }
        catch {
          serverOrigin = 'https://next.roayc.com'
        }
      }
      else {
        serverOrigin = 'https://next.roayc.com'
      }
      storage.setOrigin(serverOrigin)
    },
    getApiBaseUrl() {
      const origin = serverOrigin || 'https://next.roayc.com'
      return `${origin}/api`
    },
    getServerOrigin() {
      return serverOrigin || 'https://next.roayc.com'
    },
    async configureServer(serverUrl) {
      const origin = normalizeServerOrigin(serverUrl)
      const origins = [`${origin}/*`]
      const hasPermission = await chromeApi.permissions.contains({ origins })
      if (!hasPermission && !await chromeApi.permissions.request({ origins }))
        throw new Error('未授予访问该服务器的权限。')

      try {
        await validateServer(origin)
        await storage.writeRuntimeValue(SERVER_ORIGIN_KEY, origin)
      }
      catch (error) {
        if (!hasPermission) {
          try {
            await chromeApi.permissions.remove({ origins })
          }
          catch {
            // Keep the original connection error; stale permissions can be
            // removed later from Chrome's extension settings.
          }
        }
        throw error
      }

      const previousOrigin = serverOrigin
      serverOrigin = origin
      storage.setOrigin(origin)
      if (previousOrigin && previousOrigin !== origin) {
        try {
          await chromeApi.permissions.remove({ origins: [`${previousOrigin}/*`] })
        }
        catch (error) {
          console.warn('Failed to remove the previous server permission.', error)
        }
      }
      return origin
    },
    resolveUrl(url) {
      if (!url || !serverOrigin || !url.startsWith('/'))
        return url
      return new URL(url, serverOrigin).href
    },
    resolveNavigationUrl(url) {
      return resolveHttpUrl(url, serverOrigin ?? window.location.href)
    },
    openUrl(url, mode) {
      const target = resolveHttpUrl(url, serverOrigin ?? window.location.href)
      if (mode === 'current') {
        window.location.assign(target)
        return
      }
      window.open(target, '_blank', 'noopener,noreferrer')
    },
  }
}
