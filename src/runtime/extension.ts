import type { RuntimeAdapter, StorageAdapter, StorageChangeEvent } from './types'
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
  oldValue?: unknown
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

export class ChromeStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, string>()
  private readonly lastPersistedValues = new Map<string, string>()
  private readonly keyVersions = new Map<string, number>()
  private readonly listeners = new Set<(change: StorageChangeEvent) => void>()
  private readonly localMutations = new Map<string, Array<{ id: number, value: string | undefined }>>()
  private origin: string | null = null
  private writeQueue = Promise.resolve()
  private mutationId = 0
  private latestOpId = 0
  private pendingOps: Array<{ opId: number, error?: unknown }> = []

  constructor(private readonly area: ChromeStorageArea, onChanged: ChromeRuntimeApi['storage']['onChanged']) {
    onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local')
        return
      for (const [key, change] of Object.entries(changes)) {
        if (typeof change.newValue === 'string') {
          this.values.set(key, change.newValue)
          this.lastPersistedValues.set(key, change.newValue)
        }
        else if (change.newValue === undefined) {
          this.values.delete(key)
          this.lastPersistedValues.delete(key)
        }

        if (this.consumeLocalMutation(key, change.newValue))
          continue
        const normalized = this.normalizeChange(key, change)
        if (normalized)
          this.listeners.forEach(listener => listener(normalized))
      }
    })
  }

  private normalizeChange(key: string, change: ChromeStorageChange): StorageChangeEvent | null {
    if (key === SERVER_ORIGIN_KEY) {
      return {
        key,
        scope: 'runtime',
        oldValue: typeof change.oldValue === 'string' ? change.oldValue : null,
        newValue: typeof change.newValue === 'string' ? change.newValue : null,
      }
    }
    if (!this.origin)
      return null
    const prefix = `${DATA_PREFIX}${encodeURIComponent(this.origin)}.`
    if (!key.startsWith(prefix))
      return null
    return {
      key: key.slice(prefix.length),
      scope: 'data',
      oldValue: typeof change.oldValue === 'string' ? change.oldValue : null,
      newValue: typeof change.newValue === 'string' ? change.newValue : null,
    }
  }

  private markLocalMutation(key: string, value: string | undefined) {
    const marker = { id: ++this.mutationId, value }
    const markers = this.localMutations.get(key) ?? []
    markers.push(marker)
    this.localMutations.set(key, markers)
    return marker
  }

  private forgetLocalMutation(key: string, markerId: number) {
    const markers = this.localMutations.get(key)
    if (!markers)
      return
    const remaining = markers.filter(marker => marker.id !== markerId)
    if (remaining.length)
      this.localMutations.set(key, remaining)
    else
      this.localMutations.delete(key)
  }

  private consumeLocalMutation(key: string, value: unknown) {
    const markers = this.localMutations.get(key)
    if (!markers)
      return false
    const index = markers.findIndex(marker => marker.value === value)
    if (index < 0)
      return false
    markers.splice(index, 1)
    if (!markers.length)
      this.localMutations.delete(key)
    return true
  }

  private async mutateStorage(changes: Array<[string, string | undefined]>, operation: () => Promise<void>) {
    const markers = changes.map(([key, value]) => ({
      key,
      marker: this.markLocalMutation(key, value),
    }))

    try {
      await operation()
    }
    finally {
      // Chrome normally emits onChanged before resolving the write. Clean up
      // no-op writes as well, without suppressing a later external mutation.
      setTimeout(() => {
        markers.forEach(({ key, marker }) => this.forgetLocalMutation(key, marker.id))
      }, 250)
    }
  }

  async preload() {
    const stored = await this.area.get(null)
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === 'string') {
        this.values.set(key, value)
        this.lastPersistedValues.set(key, value)
      }
    }
  }

  async sync() {
    const stored = await this.area.get(null)
    this.values.clear()
    this.lastPersistedValues.clear()
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === 'string') {
        this.values.set(key, value)
        this.lastPersistedValues.set(key, value)
      }
    }
  }

  readRuntimeValue(key: string) {
    return this.values.get(key) ?? null
  }

  async writeRuntimeValue(key: string, value: string) {
    const version = (this.keyVersions.get(key) ?? 0) + 1
    this.keyVersions.set(key, version)
    this.values.set(key, value)
    try {
      await this.mutateStorage([[key, value]], () => this.area.set({ [key]: value }))
      this.lastPersistedValues.set(key, value)
    }
    catch (error) {
      if (this.keyVersions.get(key) === version) {
        const persisted = this.lastPersistedValues.get(key)
        if (persisted !== undefined)
          this.values.set(key, persisted)
        else
          this.values.delete(key)
      }
      throw error
    }
  }

  setOrigin(origin: string | null) {
    this.origin = origin
  }

  private scopedKey(key: string) {
    if (!this.origin)
      return null
    return `${DATA_PREFIX}${encodeURIComponent(this.origin)}.${key}`
  }

  private enqueue(opId: number, operation: () => Promise<void>) {
    const entry: { opId: number, error?: unknown } = { opId, error: undefined }
    this.pendingOps.push(entry)
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await operation()
      }
      catch (error) {
        entry.error = error
        console.error('Failed to persist extension storage.', error)
      }
    })
  }

  getItem(key: string) {
    const scopedKey = this.scopedKey(key)
    return scopedKey ? this.values.get(scopedKey) ?? null : null
  }

  keys() {
    if (!this.origin)
      return []
    const prefix = `${DATA_PREFIX}${encodeURIComponent(this.origin)}.`
    return [...this.values.keys()]
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length))
  }

  setItem(key: string, value: string) {
    const scopedKey = this.scopedKey(key)
    if (!scopedKey)
      return
    const opId = ++this.latestOpId
    const version = (this.keyVersions.get(scopedKey) ?? 0) + 1
    this.keyVersions.set(scopedKey, version)
    this.values.set(scopedKey, value)
    this.enqueue(opId, async () => {
      try {
        await this.mutateStorage([[scopedKey, value]], () => this.area.set({ [scopedKey]: value }))
        this.lastPersistedValues.set(scopedKey, value)
      }
      catch (error) {
        if (this.keyVersions.get(scopedKey) === version) {
          const persisted = this.lastPersistedValues.get(scopedKey)
          if (persisted !== undefined)
            this.values.set(scopedKey, persisted)
          else
            this.values.delete(scopedKey)
        }
        throw error
      }
    })
  }

  removeItem(key: string) {
    const scopedKey = this.scopedKey(key)
    if (!scopedKey)
      return
    const opId = ++this.latestOpId
    const version = (this.keyVersions.get(scopedKey) ?? 0) + 1
    this.keyVersions.set(scopedKey, version)
    this.values.delete(scopedKey)
    this.enqueue(opId, async () => {
      try {
        await this.mutateStorage([[scopedKey, undefined]], () => this.area.remove(scopedKey))
        this.lastPersistedValues.delete(scopedKey)
      }
      catch (error) {
        if (this.keyVersions.get(scopedKey) === version) {
          const persisted = this.lastPersistedValues.get(scopedKey)
          if (persisted !== undefined)
            this.values.set(scopedKey, persisted)
        }
        throw error
      }
    })
  }

  clear() {
    if (!this.origin)
      return
    const prefix = `${DATA_PREFIX}${encodeURIComponent(this.origin)}.`
    const targetKeys: string[] = []
    const affectedVersions = new Map<string, number>()
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) {
        targetKeys.push(key)
        const version = (this.keyVersions.get(key) ?? 0) + 1
        this.keyVersions.set(key, version)
        affectedVersions.set(key, version)
        this.values.delete(key)
      }
    }
    if (targetKeys.length) {
      const opId = ++this.latestOpId
      this.enqueue(opId, async () => {
        try {
          await this.mutateStorage(targetKeys.map(key => [key, undefined]), () => this.area.remove(targetKeys))
          targetKeys.forEach(k => this.lastPersistedValues.delete(k))
        }
        catch (error) {
          for (const [key, ver] of affectedVersions.entries()) {
            if (this.keyVersions.get(key) === ver) {
              const persisted = this.lastPersistedValues.get(key)
              if (persisted !== undefined)
                this.values.set(key, persisted)
            }
          }
          throw error
        }
      })
    }
  }

  subscribe(listener: (change: StorageChangeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async flush() {
    const targetOpId = this.latestOpId
    // Capture the operation entries before awaiting. Multiple concurrent
    // flush callers must each observe failures from the operations that were
    // pending when that caller started; consuming the shared array first
    // would otherwise let a second caller report a false success.
    const targetOps = this.pendingOps.filter(op => op.opId <= targetOpId)
    await this.writeQueue
    const failedOp = targetOps.find(op => op.error !== undefined)
    this.pendingOps = this.pendingOps.filter(op => op.opId > targetOpId)
    if (failedOp) {
      throw failedOp.error
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

    // 校验最低后端 API 版本，给出明确升级提示
    const capabilityResponse = await fetch(`${origin}/api/v1/client/capabilities`, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
    if (capabilityResponse.ok) {
      const capability = await capabilityResponse.json() as {
        apiVersion?: { current?: unknown; minimum?: unknown }
      }
      const minimum = Number(capability.apiVersion?.minimum ?? 1)
      if (!Number.isFinite(minimum) || minimum > 1)
        throw new Error('服务器版本过旧，请升级 Panel Next 服务端后再连接。')
    }
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
