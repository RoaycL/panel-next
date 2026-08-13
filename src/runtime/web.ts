import type { RuntimeAdapter, RuntimeKind, StorageAdapter } from './types'

class WebStorageAdapter implements StorageAdapter {
  constructor(private readonly storage: Storage) {}

  getItem(key: string) {
    return this.storage.getItem(key)
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
    openUrl(url, mode) {
      const target = new URL(url, window.location.href)
      if (target.protocol !== 'http:' && target.protocol !== 'https:')
        throw new Error('Only HTTP and HTTPS links can be opened.')
      if (mode === 'current') {
        window.location.assign(target.href)
        return
      }
      window.open(target.href, '_blank', 'noopener,noreferrer')
    },
  }
}
