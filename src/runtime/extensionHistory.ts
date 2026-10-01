import { getRuntime } from '@/runtime'
import type { ExtensionWidgetPreferences } from './extensionAppearance'

const HISTORY_KEY = 'PANEL_NEXT_EXTENSION_LAYOUT_HISTORY_V1'
export interface ExtensionLayoutSnapshot { appearance: Panel.panelConfig | null; widgets: ExtensionWidgetPreferences }
export interface ExtensionLayoutHistoryEntry { id: string; createdAt: string; label: string; accountId: number; snapshot: ExtensionLayoutSnapshot }

/** Compatibility shim: discard retired local versions, never create new ones. */
export function readExtensionLayoutHistory(): ExtensionLayoutHistoryEntry[] { return [] }
export async function recordExtensionLayoutHistory(_snapshot: ExtensionLayoutSnapshot, _label: string, _coalesce = true) {
  const storage = getRuntime().storage
  if (storage.getItem(HISTORY_KEY) !== null) {
    storage.removeItem(HISTORY_KEY)
    await storage.flush?.()
  }
  return false
}
export async function restoreExtensionLayoutHistory(_id: string) {
  throw new Error('已改为仅同步最新状态，不再保留或恢复历史版本；可导入手动备份')
}
