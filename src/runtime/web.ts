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

/**
 * 部署恢复：前端重新发布后，旧标签页持有的 index.html 仍指向已不存在的
 * 异步 chunk。用户点击懒加载入口（应用盒子、编辑弹窗、设置页等）时
 * 动态导入会静默失败，表现为「按钮点了没反应」。这里统一捕获并自动
 * 刷新一次以加载新版本；sessionStorage 守卫避免刷新死循环。
 *
 * 仅 Web 平台适用（扩展从打包文件加载，不存在 chunk 哈希漂移）；
 * sessionStorage 属平台存储，按架构边界只在 runtime 适配器内使用。
 */
const STALE_CHUNK_RELOAD_KEY = 'PANEL_NEXT_STALE_CHUNK_RELOAD'

function reloadOnStaleChunk() {
  try {
    if (window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY))
      return
    window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()))
    setTimeout(() => {
      window.sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY)
    }, 5000)
    window.location.reload()
  }
  catch {
    window.location.reload()
  }
}

function setupStaleChunkRecovery() {
  window.addEventListener('vite:preloadError', reloadOnStaleChunk)
  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason instanceof Error ? event.reason.message : String(event.reason ?? '')
    if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message))
      reloadOnStaleChunk()
  })
}

export function createWebRuntime(kind: RuntimeKind): RuntimeAdapter {
  setupStaleChunkRecovery()
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
