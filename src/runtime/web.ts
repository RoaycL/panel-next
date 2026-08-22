import type { RuntimeAdapter, RuntimeKind, StorageAdapter } from './types'
import { resolveHttpUrl } from './url'

class WebStorageAdapter implements StorageAdapter {
  constructor(private readonly storage: Storage) {}

  getItem(key: string) {
    return this.storage.getItem(key)
  }

  keys() {
    return Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index))
      .filter((key): key is string => key !== null)
  }

  setItem(key: string, value: string) {
    this.storage.setItem(key, value)
  }

  removeItem(key: string) {
    this.storage.removeItem(key)
  }

  clear() {
    this.storage.clear()
  }
}

export function createWebRuntime(kind: RuntimeKind): RuntimeAdapter {
  return {
    kind,
    storage: new WebStorageAdapter(window.localStorage),
    async ready() {},
    getApiBaseUrl() {
      return import.meta.env.VITE_GLOB_API_URL
    },
    getServerOrigin() {
      return window.location.origin
    },
    async configureServer() {
      throw new Error('Web mode always uses the current server.')
    },
    resolveUrl(url) {
      return url
    },
    resolveNavigationUrl(url) {
      return resolveHttpUrl(url, window.location.href)
    },
    openUrl(url, mode) {
      const target = resolveHttpUrl(url, window.location.href)
      if (mode === 'current') {
        window.location.assign(target)
        return
      }
      window.open(target, '_blank', 'noopener,noreferrer')
    },
  }
}
