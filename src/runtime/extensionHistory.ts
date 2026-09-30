import { getRuntime } from '@/runtime'
import { useAuthStore } from '@/store/modules/auth'
import { readExtensionAppearance, readExtensionWidgets, restoreExtensionLayoutSnapshot } from './extensionAppearance'
import type { ExtensionWidgetPreferences } from './extensionAppearance'

const HISTORY_KEY = 'PANEL_NEXT_EXTENSION_LAYOUT_HISTORY_V1'
const MAX_ENTRIES = 24
const MAX_BYTES = 2 * 1024 * 1024
const MAX_SNAPSHOT_BYTES = 400 * 1024
const COALESCE_MS = 90_000

export interface ExtensionLayoutSnapshot {
  appearance: Panel.panelConfig | null
  widgets: ExtensionWidgetPreferences
}

export interface ExtensionLayoutHistoryEntry {
  id: string
  createdAt: string
  label: string
  accountId: number
  snapshot: ExtensionLayoutSnapshot
}

function size(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function safeSnapshot(snapshot: ExtensionLayoutSnapshot): ExtensionLayoutSnapshot {
  const widgets = JSON.parse(JSON.stringify(snapshot.widgets)) as ExtensionWidgetPreferences
  // Search terms and cleanup queue are not part of a restorable layout.
  widgets.searchHistory = []
  widgets.pendingWidgetCleanupIds = []
  return { appearance: snapshot.appearance ? JSON.parse(JSON.stringify(snapshot.appearance)) : null, widgets }
}

function readAllHistory(): ExtensionLayoutHistoryEntry[] {
  const raw = getRuntime().storage.getItem(HISTORY_KEY)
  if (!raw)
    return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed))
      return []
    return parsed.filter((entry): entry is ExtensionLayoutHistoryEntry =>
      entry !== null && typeof entry === 'object'
      && typeof entry.id === 'string' && typeof entry.createdAt === 'string'
      && typeof entry.label === 'string' && Number.isSafeInteger(entry.accountId)
      && entry.snapshot?.widgets?.contentLayout?.schemaVersion === 1
      && Array.isArray(entry.snapshot.widgets.contentLayout.widgets))
  }
  catch {
    return []
  }
}

export function readExtensionLayoutHistory(): ExtensionLayoutHistoryEntry[] {
  const accountId = useAuthStore().userInfo?.id ?? 0
  return readAllHistory().filter(entry => entry.accountId === accountId)
}

/** Best-effort bounded local history; a quota failure never rolls back a saved layout. */
export async function recordExtensionLayoutHistory(snapshot: ExtensionLayoutSnapshot, label: string, coalesce = true) {
  if (getRuntime().kind !== 'extension')
    return false
  const normalized = safeSnapshot(snapshot)
  const serializedSnapshot = JSON.stringify(normalized)
  if (size(serializedSnapshot) > MAX_SNAPSHOT_BYTES)
    return false

  const runtime = getRuntime()
  const entries = readAllHistory()
  const accountId = useAuthStore().userInfo?.id ?? 0
  const latest = entries.find(item => item.accountId === accountId)
  if (latest && JSON.stringify(latest.snapshot) === serializedSnapshot
    && (label !== '恢复前备份' || latest.label === label))
    return true
  const now = new Date()
  const entry: ExtensionLayoutHistoryEntry = {
    id: crypto.randomUUID(), createdAt: now.toISOString(), label, accountId, snapshot: normalized,
  }
  if (coalesce && latest?.label === label && now.getTime() - Date.parse(latest.createdAt) < COALESCE_MS)
    entries.splice(entries.indexOf(latest), 1)
  entries.unshift(entry)
  entries.splice(MAX_ENTRIES)
  while (entries.length && size(JSON.stringify(entries)) > MAX_BYTES)
    entries.pop()
  try {
    runtime.storage.setItem(HISTORY_KEY, JSON.stringify(entries))
    await runtime.storage.flush?.()
    return true
  }
  catch (error) {
    console.warn('Unable to retain extension layout history.', error)
    return false
  }
}

export async function restoreExtensionLayoutHistory(id: string) {
  const entry = readExtensionLayoutHistory().find(item => item.id === id)
  if (!entry)
    throw new Error('找不到这条历史记录')
  const current = { appearance: readExtensionAppearance(), widgets: readExtensionWidgets() }
  if (!await recordExtensionLayoutHistory(current, '恢复前备份', false))
    throw new Error('无法保存当前布局的恢复前备份，已取消回滚')
  await restoreExtensionLayoutSnapshot(entry.snapshot)
}
