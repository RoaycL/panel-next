import type { RuntimeAdapter } from './types'
import { createWebRuntime } from './web'

export type { OpenUrlMode, RuntimeAdapter, RuntimeKind, StorageAdapter } from './types'

// EXT-03 will replace the extension storage implementation with a preloadable
// chrome.storage.local adapter. Keeping the platform choice here prevents the
// shared UI from importing chrome.* directly.
const runtime: RuntimeAdapter = createWebRuntime(__PANEL_RUNTIME__)

export function getRuntime(): RuntimeAdapter {
  return runtime
}
