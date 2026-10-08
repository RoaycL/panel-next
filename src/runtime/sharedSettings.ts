import { ref } from 'vue'
import { getBootstrap } from '@/api/sync'
import { mutationPost } from '@/api/panel/mutation'
import { useAppStore, useAuthStore, usePanelState } from '@/store'
import { getSyncRevision, setSyncRevision } from '@/sync/revision'
import { getRuntime } from './index'
import { EXTENSION_APPEARANCE_KEY, EXTENSION_WIDGETS_KEY, readExtensionWidgets } from './extensionAppearance'
import type { ExtensionWidgetPreferences } from './extensionAppearance'
import { readWallpaperFavorites, wallpaperFavoritesKey } from './wallpaperFavorites'
import type { FavoriteWallpaper } from './wallpaperFavorites'
import { onSettingsChanged } from './settingsEvents'
import { clearSyncFailure, reportSyncFailure, trackSyncActivity } from '@/sync/activity'

export interface SharedPreferences {
  schemaVersion: 1
  networkMode: 0 | 1 | 2
  app: { theme: 'auto' | 'light' | 'dark', language: 'zh-CN' | 'en-US' }
  widgets: ExtensionWidgetPreferences
  favorites: FavoriteWallpaper[]
}
interface SettingsSnapshot { panel: Panel.panelConfig, preferences: SharedPreferences }
export const settingsSyncState = ref<'local' | 'pending' | 'syncing' | 'synced' | 'error'>('local')
export const settingsSyncError = ref('')
const PREFIX = 'PANEL_NEXT_LATEST_SETTINGS_V1:'
let applying = false
let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let activeFlush: Promise<void> | null = null
let activeScope = ''
let lastBytes = ''

function scope() {
  const auth = useAuthStore()
  return auth.token && auth.userInfo?.id ? `${encodeURIComponent(getRuntime().getServerOrigin() || '')}:${auth.userInfo.id}` : ''
}
function stripPanel(config: Panel.panelConfig): Panel.panelConfig {
  const panel = JSON.parse(JSON.stringify(config))
  delete panel.sharedPreferences
  return panel
}
function capture(): SettingsSnapshot {
  const app = useAppStore()
  const panel = usePanelState()
  const runtime = getRuntime()
  const widgets = JSON.parse(JSON.stringify(readExtensionWidgets()))
  widgets.searchHistory = [] // Queries are private usage data, not settings.
  widgets.pendingWidgetCleanupIds = [] // Never sync local deletion jobs.
  const config = stripPanel(panel.panelConfig)
  if (runtime.kind === 'extension') {
    config.clockShow = widgets.clock
    config.clockShowSecond = widgets.clockSeconds
    config.searchBoxShow = widgets.search
  }
  else {
    widgets.clock = config.clockShow !== false
    widgets.clockSeconds = config.clockShowSecond !== false
    widgets.search = config.searchBoxShow !== false
  }
  return {
    panel: config,
    preferences: {
      schemaVersion: 1, networkMode: panel.networkMode === 0 || panel.networkMode === 1 ? panel.networkMode : 2,
      app: { theme: app.theme, language: app.language }, widgets,
      favorites: readWallpaperFavorites(runtime.storage, wallpaperFavoritesKey(runtime.getServerOrigin(), useAuthStore().userInfo?.id), runtime.getServerOrigin()),
    },
  }
}
function readPending(key: string): SettingsSnapshot | null {
  try {
    const value = JSON.parse(getRuntime().storage.getItem(PREFIX + key) || 'null')
    return value?.panel && value?.preferences?.schemaVersion === 1 ? value : null
  }
  catch { return null }
}

export function scheduleSettingsSync() { stageSettings(capture()) }
export function stageWidgetSettings(preferences: ExtensionWidgetPreferences) {
  const snapshot = capture()
  snapshot.preferences.widgets = JSON.parse(JSON.stringify({ ...preferences, searchHistory: [], pendingWidgetCleanupIds: [] }))
  snapshot.panel.clockShow = preferences.clock
  snapshot.panel.clockShowSecond = preferences.clockSeconds
  snapshot.panel.searchBoxShow = preferences.search
  stageSettings(snapshot)
}
function stageSettings(snapshot: SettingsSnapshot) {
  const key = scope()
  if (applying || !key || key !== activeScope) return
  const bytes = JSON.stringify(snapshot)
  if (bytes === lastBytes && !readPending(key)) return
  if (new TextEncoder().encode(bytes).byteLength > 800 * 1024) {
    settingsSyncState.value = 'error'
    settingsSyncError.value = '设置超过同步安全上限（800 KB），请减少过大的组件配置或布局后重试；本机设置仍保留。'
    return
  }
  // Stage intent immediately, before any incoming refresh or debounce delay.
  getRuntime().storage.setItem(PREFIX + key, bytes)
  settingsSyncState.value = 'pending'
  clearTimeout(timer)
  timer = setTimeout(() => { void saveLatest() }, 450)
}
async function saveLatest() {
  const key = scope()
  if (!key || key !== activeScope || applying) return
  const snapshot = readPending(key)
  if (!snapshot) return
  const bytes = JSON.stringify(snapshot)
  const runtime = getRuntime()
  try {
    // One pending slot per server/account. New edits replace unsent old edits.
    runtime.storage.setItem(PREFIX + key, bytes)
    await runtime.storage.flush?.()
    settingsSyncState.value = 'pending'
    await flushLatestSettings()
  }
  catch (error) { settingsSyncState.value = 'error'; settingsSyncError.value = String(error) }
}

export function flushLatestSettings(): Promise<void> {
  if (activeFlush) return activeFlush
  const task = flushLatestSettingsInternal()
  activeFlush = task
  void task.finally(() => {
    if (activeFlush === task) activeFlush = null
    if (settingsSyncState.value === 'pending' && navigator.onLine && readPending(scope()))
      setTimeout(() => { void flushLatestSettings() }, 0)
  })
  return task
}
async function flushLatestSettingsInternal() {
  if (running || !navigator.onLine) return
  const key = scope()
  const runtime = getRuntime()
  const accountId = useAuthStore().userInfo?.id
  if (!key || !accountId) return
  const run = async () => {
    const snapshot = readPending(key)
    if (!snapshot || scope() !== key) return
    const bytes = JSON.stringify(snapshot)
    settingsSyncState.value = 'syncing'
    for (let attempt = 0; attempt < 3; attempt++) {
      const baseline = await getBootstrap()
      if (scope() !== key) return
      if (baseline.code !== 0 || baseline.data?.account.id !== accountId) throw new Error('无法读取当前账号的云端设置，稍后重试')
      setSyncRevision(baseline.data.revision, { authoritative: true })
      const panel = { ...baseline.data.panel.config, ...snapshot.panel, sharedPreferences: snapshot.preferences }
      const result = await mutationPost('/panel/userConfig/set', { panel }, { queueOnFailure: false })
      if (scope() !== key) return
      if (result.code === 1502) continue // Re-read current state before retrying.
      if (result.code !== 0) throw new Error(result.msg || '设置同步失败')
      // A delayed cached bootstrap cannot revert this accepted local choice.
      runtime.storage.setItem(`${PREFIX}${key}:accepted`, JSON.stringify({ revision: getSyncRevision(), snapshot }))
      if (runtime.storage.getItem(PREFIX + key) === bytes) runtime.storage.removeItem(PREFIX + key)
      await runtime.storage.flush?.()
      lastBytes = bytes
      settingsSyncState.value = readPending(key) ? 'pending' : 'synced'
      settingsSyncError.value = ''
      clearSyncFailure()
      return
    }
    throw new Error('另一端正在修改设置，稍后自动同步最新选择')
  }
  running = true
  try {
    await trackSyncActivity(async () => {
      if (navigator.locks) await navigator.locks.request(`panel-next-latest-settings:${key}`, run)
      else await run()
    })
  }
  catch (error) {
    settingsSyncState.value = 'error'
    settingsSyncError.value = error instanceof Error ? error.message : '设置已保存在本机，连接恢复后重试'
    reportSyncFailure(`设置同步失败：${settingsSyncError.value}`)
  }
  finally { running = false }
}

/** Apply the newest account-scoped settings, never an older pending snapshot. */
export function receiveSharedSettings(config: Panel.panelConfig, accountId: number, revision: Sync.Revision): Panel.panelConfig {
  const key = scope()
  if (!key || useAuthStore().userInfo?.id !== accountId) return config
  const runtime = getRuntime()
  let pending = readPending(key)
  try {
    const accepted = JSON.parse(runtime.storage.getItem(`${PREFIX}${key}:accepted`) || 'null')
    if (!pending && accepted?.snapshot && BigInt(accepted.revision) > BigInt(revision)) pending = accepted.snapshot
  }
  catch { /* Invalid receipts cannot prevent fresh cloud state. */ }
  const effective = pending ? { ...pending.panel, sharedPreferences: pending.preferences } : config
  const shared = effective.sharedPreferences
  applying = true
  try {
    if (shared?.schemaVersion === 1) {
      const panel = usePanelState()
      const app = useAppStore()
      if ([0, 1, 2].includes(shared.networkMode)) panel.setNetworkMode(shared.networkMode)
      if (['auto', 'light', 'dark'].includes(shared.app?.theme)) app.setTheme(shared.app.theme)
      if (['zh-CN', 'en-US'].includes(shared.app?.language)) app.setLanguage(shared.app.language)
      if (shared.widgets && typeof shared.widgets === 'object') {
        const current = readExtensionWidgets()
        runtime.storage.setItem(EXTENSION_WIDGETS_KEY, JSON.stringify({ ...shared.widgets, searchHistory: current.searchHistory, pendingWidgetCleanupIds: current.pendingWidgetCleanupIds }))
      }
      const favoriteKey = wallpaperFavoritesKey(runtime.getServerOrigin(), accountId)
      if (Array.isArray(shared.favorites)) runtime.storage.setItem(favoriteKey, JSON.stringify(shared.favorites))
    }
    usePanelState().applyPanelConfig(effective)
    if (runtime.kind === 'extension') runtime.storage.setItem(EXTENSION_APPEARANCE_KEY, JSON.stringify(effective))
    activeScope = key
    lastBytes = JSON.stringify(capture())
    settingsSyncState.value = readPending(key) ? 'pending' : 'synced'
    void runtime.storage.flush?.().catch(() => { settingsSyncState.value = 'error' })
  }
  finally { applying = false }
  // A legacy server has no envelope yet: migrate once, not on every refresh.
  if (!shared && !pending) { lastBytes = ''; scheduleSettingsSync() }
  if (readPending(key)) void flushLatestSettings()
  return effective
}

export function initializeSharedSettings() {
  const storage = getRuntime().storage
  if (storage.getItem('PANEL_NEXT_EXTENSION_LAYOUT_HISTORY_V1') !== null) {
    storage.removeItem('PANEL_NEXT_EXTENSION_LAYOUT_HISTORY_V1')
    void storage.flush?.().catch(() => { settingsSyncState.value = 'error' })
  }
  onSettingsChanged(scheduleSettingsSync)
  usePanelState().$subscribe(scheduleSettingsSync, { detached: true, flush: 'sync' })
  useAppStore().$subscribe(scheduleSettingsSync, { detached: true, flush: 'sync' })
  window.addEventListener('online', () => { void flushLatestSettings() })
  setInterval(() => { void flushLatestSettings() }, 30_000)
}
