import { getRuntime } from '@/runtime'
import { WIDGET_ID_PATTERN, serializeWidgetLayout } from '@/widgets'
import type { WidgetInstance, WidgetLayout } from '@/widgets'
import { clearWidgetStorage } from '@/widgets/context'
import { recordExtensionLayoutHistory } from './extensionHistory'
import type { ExtensionLayoutSnapshot } from './extensionHistory'

export const EXTENSION_APPEARANCE_KEY = 'PANEL_NEXT_EXTENSION_APPEARANCE_V1'
export const EXTENSION_WIDGETS_KEY = 'PANEL_NEXT_EXTENSION_WIDGETS_V1'
const MAX_PENDING_WIDGET_CLEANUPS = 100

export interface ExtensionWidgetPreferences {
  clock: boolean
  clockSeconds: boolean
  clockDate: boolean
  clockHourCycle: '12' | '24'
  search: boolean
  searchEngineId: ExtensionSearchEngineId
  searchOpenMode: 'current' | 'tab'
  searchHistoryEnabled: boolean
  searchHistory: string[]
  weather: boolean
  trending: boolean
  sidebarPosition: 'left' | 'right'
  sidebarAutoHide: boolean
  /** Versioned default migration; explicit choices made in v2 are retained. */
  sidebarBehaviorVersion?: 2
  sidebarWheelSwitch: boolean
  sidebarDensity: 'compact' | 'comfortable'
  /** Extension-only bookmark tile sizes. Keys are accountId:itemId. */
  bookmarkLayouts: Record<string, ExtensionBookmarkLayout>
  /** Extension-only dashboard layouts. Keys are accountId:groupId. */
  pageLayouts: Record<string, ExtensionPageLayout>
  /**
   * Legacy global widget layout. It is retained only as a migration source and
   * is cleared after the first real page adopts it.
   */
  contentLayout: WidgetLayout
  pendingWidgetCleanupIds?: string[]
}

export type ExtensionSearchEngineId = 'baidu' | 'google' | 'bing' | 'github' | 'bilibili' | 'duckduckgo'

export interface ExtensionBookmarkLayout {
  columns: 1 | 2
  rows: 1 | 2 | 4
}

export interface ExtensionPageLayout {
  contentLayout: WidgetLayout
  /** Mixed bookmark/widget order inside the page's shared grid. */
  itemOrder: string[]
}

const BOOKMARK_LAYOUT_KEYS = new Set(['1x1', '1x2', '2x1', '2x2', '2x4'])
const SEARCH_ENGINE_IDS = new Set<ExtensionSearchEngineId>(['baidu', 'google', 'bing', 'github', 'bilibili', 'duckduckgo'])
const MAX_BOOKMARK_LAYOUTS = 500
const MAX_PAGE_LAYOUTS = 100
const MAX_PAGE_ORDER_ITEMS = 600
const MAX_SEARCH_HISTORY = 10
const MAX_SEARCH_QUERY_LENGTH = 200
const MAX_EXTENSION_WIDGET_PREFERENCES_BYTES = 4 * 1024 * 1024
const PAGE_LAYOUT_KEY_PATTERN = /^[\w.:-]{1,120}$/
const PAGE_ITEM_KEY_PATTERN = /^(?:bookmark|widget):[\w.:-]{1,80}$/

export const defaultExtensionWidgets: ExtensionWidgetPreferences = {
  clock: true,
  clockSeconds: true,
  clockDate: true,
  clockHourCycle: '24',
  search: true,
  searchEngineId: 'baidu',
  searchOpenMode: 'tab',
  searchHistoryEnabled: true,
  searchHistory: [],
  weather: true,
  trending: true,
  sidebarPosition: 'left',
  sidebarAutoHide: true,
  sidebarBehaviorVersion: 2,
  sidebarWheelSwitch: true,
  sidebarDensity: 'comfortable',
  bookmarkLayouts: {},
  pageLayouts: {},
  contentLayout: { schemaVersion: 1, widgets: [] },
  pendingWidgetCleanupIds: [],
}

function defaultWidgetPreferences(): ExtensionWidgetPreferences {
  return {
    ...defaultExtensionWidgets,
    contentLayout: { schemaVersion: 1, widgets: [] },
    bookmarkLayouts: {},
    pageLayouts: {},
    searchHistory: [],
    pendingWidgetCleanupIds: [],
  }
}

function isPanelConfig(value: unknown): value is Panel.panelConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Extension-only visual preferences. Groups, bookmarks and account data remain server-backed. */
export function readExtensionAppearance(): Panel.panelConfig | null {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return null

  const raw = runtime.storage.getItem(EXTENSION_APPEARANCE_KEY)
  if (!raw)
    return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isPanelConfig(parsed) ? parsed : null
  }
  catch {
    runtime.storage.removeItem(EXTENSION_APPEARANCE_KEY)
    return null
  }
}

let extensionStorageSaveChain: Promise<unknown> = Promise.resolve()

function enqueueExtensionStorageSave<T>(operation: () => Promise<T>): Promise<T> {
  const result = extensionStorageSaveChain.catch(() => undefined).then(operation)
  // One shared queue is required because runtime.storage.flush() covers all
  // storage operations enqueued before that call, not just one preference key.
  extensionStorageSaveChain = result.then(() => undefined, () => undefined)
  return result
}

export function saveExtensionAppearance(config: Panel.panelConfig): Promise<boolean> {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return Promise.resolve(true)

  const serialized = JSON.stringify(config)

  return enqueueExtensionStorageSave(async () => {
    // 字节级去重
    if (runtime.storage.getItem(EXTENSION_APPEARANCE_KEY) === serialized)
      return true

    const previous = readExtensionAppearance()
    if (previous)
      await recordExtensionLayoutHistory({ appearance: previous, widgets: readExtensionWidgets() }, '外观修改前', false)

    runtime.storage.setItem(EXTENSION_APPEARANCE_KEY, serialized)
    try {
      await runtime.storage.flush?.()
      await recordExtensionLayoutHistory({ appearance: config, widgets: readExtensionWidgets() }, '外观修改')
      return true
    }
    catch (error) {
      console.error('Failed to save extension appearance.', error)
      throw error
    }
  })
}

export function readExtensionWidgets(): ExtensionWidgetPreferences {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return defaultWidgetPreferences()
  try {
    const parsed = JSON.parse(runtime.storage.getItem(EXTENSION_WIDGETS_KEY) || '{}') as Partial<ExtensionWidgetPreferences>
    const contentLayout = parsed.contentLayout
      && typeof parsed.contentLayout === 'object'
      && parsed.contentLayout.schemaVersion === 1
      && Array.isArray(parsed.contentLayout.widgets)
      ? parsed.contentLayout
      : { schemaVersion: 1 as const, widgets: [] }

    const pendingCleanups = Array.isArray(parsed.pendingWidgetCleanupIds)
      ? Array.from(new Set(parsed.pendingWidgetCleanupIds.filter(id => typeof id === 'string' && WIDGET_ID_PATTERN.test(id)))).slice(0, MAX_PENDING_WIDGET_CLEANUPS)
      : []
    const bookmarkLayouts = parsed.bookmarkLayouts && typeof parsed.bookmarkLayouts === 'object' && !Array.isArray(parsed.bookmarkLayouts)
      ? Object.fromEntries(Object.entries(parsed.bookmarkLayouts)
          .filter(([key, value]) => /^[\w.:-]{1,80}$/.test(key)
            && value && typeof value === 'object' && !Array.isArray(value)
            && BOOKMARK_LAYOUT_KEYS.has(`${(value as ExtensionBookmarkLayout).columns}x${(value as ExtensionBookmarkLayout).rows}`))
          .slice(0, MAX_BOOKMARK_LAYOUTS)) as Record<string, ExtensionBookmarkLayout>
      : {}
    const pageLayouts = parsed.pageLayouts && typeof parsed.pageLayouts === 'object' && !Array.isArray(parsed.pageLayouts)
      ? Object.fromEntries(Object.entries(parsed.pageLayouts)
          .filter(([key, value]) => PAGE_LAYOUT_KEY_PATTERN.test(key)
            && value && typeof value === 'object' && !Array.isArray(value)
            && (value as ExtensionPageLayout).contentLayout?.schemaVersion === 1
            && Array.isArray((value as ExtensionPageLayout).contentLayout?.widgets))
          .slice(0, MAX_PAGE_LAYOUTS)
          .map(([key, value]) => {
            const page = value as ExtensionPageLayout
            const itemOrder = Array.isArray(page.itemOrder)
              ? Array.from(new Set(page.itemOrder.filter(item => typeof item === 'string' && PAGE_ITEM_KEY_PATTERN.test(item)))).slice(0, MAX_PAGE_ORDER_ITEMS)
              : []
            return [key, { contentLayout: page.contentLayout, itemOrder } satisfies ExtensionPageLayout]
          })) as Record<string, ExtensionPageLayout>
      : {}
    const searchHistory = Array.isArray(parsed.searchHistory)
      ? Array.from(new Set(parsed.searchHistory
          .filter(query => typeof query === 'string')
          .map(query => query.trim())
          .filter(query => query.length > 0 && query.length <= MAX_SEARCH_QUERY_LENGTH)))
          .slice(0, MAX_SEARCH_HISTORY)
      : []
    const searchEngineId = typeof parsed.searchEngineId === 'string' && SEARCH_ENGINE_IDS.has(parsed.searchEngineId as ExtensionSearchEngineId)
      ? parsed.searchEngineId as ExtensionSearchEngineId
      : defaultExtensionWidgets.searchEngineId

    return {
      clock: parsed.clock !== false,
      clockSeconds: parsed.clockSeconds !== false,
      clockDate: parsed.clockDate !== false,
      clockHourCycle: parsed.clockHourCycle === '12' ? '12' : '24',
      search: parsed.search !== false,
      searchEngineId,
      searchOpenMode: parsed.searchOpenMode === 'current' ? 'current' : 'tab',
      searchHistoryEnabled: parsed.searchHistoryEnabled !== false,
      searchHistory,
      weather: parsed.weather !== false,
      trending: parsed.trending !== false,
      sidebarPosition: parsed.sidebarPosition === 'right' ? 'right' : 'left',
      sidebarAutoHide: parsed.sidebarBehaviorVersion === 2 ? parsed.sidebarAutoHide !== false : true,
      sidebarBehaviorVersion: 2,
      sidebarWheelSwitch: parsed.sidebarWheelSwitch !== false,
      sidebarDensity: parsed.sidebarDensity === 'compact' ? 'compact' : 'comfortable',
      bookmarkLayouts,
      pageLayouts,
      contentLayout,
      pendingWidgetCleanupIds: pendingCleanups,
    }
  }
  catch {
    return defaultWidgetPreferences()
  }
}

export function saveExtensionWidgets(
  preferences: ExtensionWidgetPreferences,
  changedPageLayoutKeys?: readonly string[],
): Promise<boolean> {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return Promise.resolve(true)

  const snapshot = JSON.parse(JSON.stringify(preferences)) as ExtensionWidgetPreferences
  return updateExtensionWidgets((current) => {
    const pageLayouts = changedPageLayoutKeys === undefined
      ? snapshot.pageLayouts ?? {}
      : changedPageLayoutKeys.reduce<Record<string, ExtensionPageLayout>>((layouts, key) => {
          const page = snapshot.pageLayouts?.[key]
          if (page)
            layouts[key] = page
          else
            delete layouts[key]
          return layouts
        }, { ...current.pageLayouts })
    return {
      ...snapshot,
      pageLayouts,
      // A page-scoped save may come from a tab that still holds the retired
      // global layout. Once another tab has migrated and cleared it, never
      // resurrect that legacy source and duplicate widgets on another page.
      contentLayout: changedPageLayoutKeys !== undefined && current.contentLayout.widgets.length === 0
        ? current.contentLayout
        : snapshot.contentLayout,
      // Cleanup tombstones are service-owned state. View models can be stale
      // because local adapter change echoes are intentionally suppressed,
      // so a regular layout save must never replace this queue.
      pendingWidgetCleanupIds: current.pendingWidgetCleanupIds ?? [],
    }
  })
}

/** Apply a history snapshot as one queued layout operation. Widget cleanup
 * tombstones and search terms belong to the current session, not history. */
export function restoreExtensionLayoutSnapshot(snapshot: ExtensionLayoutSnapshot): Promise<void> {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return Promise.reject(new Error('仅扩展页面支持本机布局恢复'))

  return enqueueExtensionStorageSave(async () => {
    const previousAppearance = runtime.storage.getItem(EXTENSION_APPEARANCE_KEY)
    const previousWidgets = runtime.storage.getItem(EXTENSION_WIDGETS_KEY)
    const currentWidgets = readExtensionWidgets()
    const widgets = {
      ...snapshot.widgets,
      searchHistory: currentWidgets.searchHistory,
      pendingWidgetCleanupIds: currentWidgets.pendingWidgetCleanupIds,
    }
    const serializedWidgets = JSON.stringify(widgets)
    if (new TextEncoder().encode(serializedWidgets).byteLength > MAX_EXTENSION_WIDGET_PREFERENCES_BYTES)
      throw new Error('历史布局超过本地安全上限，未执行恢复')

    if (snapshot.appearance)
      runtime.storage.setItem(EXTENSION_APPEARANCE_KEY, JSON.stringify(snapshot.appearance))
    else
      runtime.storage.removeItem(EXTENSION_APPEARANCE_KEY)
    runtime.storage.setItem(EXTENSION_WIDGETS_KEY, serializedWidgets)
    try {
      await runtime.storage.flush?.()
    }
    catch {
      if (previousAppearance === null)
        runtime.storage.removeItem(EXTENSION_APPEARANCE_KEY)
      else
        runtime.storage.setItem(EXTENSION_APPEARANCE_KEY, previousAppearance)
      if (previousWidgets === null)
        runtime.storage.removeItem(EXTENSION_WIDGETS_KEY)
      else
        runtime.storage.setItem(EXTENSION_WIDGETS_KEY, previousWidgets)
      try {
        await runtime.storage.flush?.()
      }
      catch {
        throw new Error('恢复失败，当前布局可能部分更改；可从“恢复前备份”再次找回')
      }
      throw new Error('恢复失败，已还原当前布局')
    }
  })
}

export function updateExtensionWidgets(
  updater: (current: ExtensionWidgetPreferences) => ExtensionWidgetPreferences,
): Promise<boolean> {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return Promise.resolve(true)

  return enqueueExtensionStorageSave(async () => {
    const previous = readExtensionWidgets()
    const next = updater(previous)
    const serialized = JSON.stringify(next)
    const serializedBytes = new TextEncoder().encode(serialized).byteLength
    if (serializedBytes > MAX_EXTENSION_WIDGET_PREFERENCES_BYTES) {
      throw new Error(`扩展页面布局数据已超过本地安全上限（${Math.ceil(serializedBytes / 1024 / 1024)} MiB / 4 MiB），请删除不再使用的小组件或分组布局后重试。`)
    }
    // 全局去重点：与已存储内容字节一致时跳过写入，避免多标签页循环触发
    if (runtime.storage.getItem(EXTENSION_WIDGETS_KEY) === serialized)
      return true

    await recordExtensionLayoutHistory({ appearance: readExtensionAppearance(), widgets: previous }, '布局修改前', false)

    runtime.storage.setItem(EXTENSION_WIDGETS_KEY, serialized)
    try {
      await runtime.storage.flush?.()
      await recordExtensionLayoutHistory({ appearance: readExtensionAppearance(), widgets: next }, '布局修改')
      return true
    }
    catch (error) {
      console.error('Failed to save extension widgets.', error)
      throw error
    }
  })
}

export interface RemoveWidgetFlowResult {
  success: boolean
  stage: 'none' | 'layout' | 'storage' | 'done'
  removedInstance: WidgetInstance | null
  updatedInstances: WidgetInstance[]
  storageCleanupFailed?: boolean
  error?: unknown
}

export async function removeExtensionWidgetFlow(
  instances: WidgetInstance[],
  targetId: string,
  quarantinedWidgets: unknown[] = [],
  currentPreferences: ExtensionWidgetPreferences = readExtensionWidgets(),
  pageLayoutKey?: string,
): Promise<RemoveWidgetFlowResult> {
  const snapshotInstances = [...instances]
  const targetIndex = instances.findIndex(inst => inst.id === targetId)
  if (targetIndex < 0) {
    return {
      success: false,
      stage: 'none',
      removedInstance: null,
      updatedInstances: instances,
    }
  }

  const updatedInstances = [...instances]
  const [removedInstance] = updatedInstances.splice(targetIndex, 1)

  // 第一阶段：保存删除后的布局，同时将待清理 ID 登记入 pendingWidgetCleanupIds
  try {
    const nextLayout = serializeWidgetLayout(updatedInstances, quarantinedWidgets)
    await updateExtensionWidgets((storedPreferences) => {
      const pending = Array.from(new Set([
        ...(storedPreferences.pendingWidgetCleanupIds ?? []),
        ...(currentPreferences.pendingWidgetCleanupIds ?? []),
      ]))
      if (!pending.includes(removedInstance.id) && pending.length >= MAX_PENDING_WIDGET_CLEANUPS)
        throw new Error('Widget cleanup queue is full; refusing to remove layout without a durable cleanup marker.')
      if (!pending.includes(removedInstance.id))
        pending.push(removedInstance.id)
      const nextPageLayouts = pageLayoutKey
        ? {
            ...storedPreferences.pageLayouts,
            [pageLayoutKey]: {
              contentLayout: nextLayout,
              itemOrder: currentPreferences.pageLayouts?.[pageLayoutKey]?.itemOrder ?? [],
            },
          }
        : currentPreferences.pageLayouts ?? storedPreferences.pageLayouts
      return {
        ...storedPreferences,
        ...currentPreferences,
        pageLayouts: nextPageLayouts,
        contentLayout: pageLayoutKey
          ? (storedPreferences.contentLayout.widgets.length === 0
              ? storedPreferences.contentLayout
              : currentPreferences.contentLayout)
          : nextLayout,
        pendingWidgetCleanupIds: pending,
      }
    })
  }
  catch (layoutError) {
    // 布局保存失败：恢复 UI，不清理私有存储
    return {
      success: false,
      stage: 'layout',
      removedInstance: null,
      updatedInstances: snapshotInstances,
      error: layoutError,
    }
  }

  // 第一阶段成功：删除正式成立，不能再回滚组件布局
  // 第二阶段：清理私有存储
  let storageCleanupFailed = false
  let storageError: unknown = null
  try {
    const ok = await enqueueExtensionStorageSave(() => clearWidgetStorage(removedInstance.id))
    if (!ok) {
      storageCleanupFailed = true
    }
    else {
      // 私有存储清理成功：从持久化待清理队列中移除并静默持久化
      await updateExtensionWidgets(current => ({
        ...current,
        pendingWidgetCleanupIds: (current.pendingWidgetCleanupIds ?? []).filter(id => id !== removedInstance.id),
      })).catch(() => {})
    }
  }
  catch (err) {
    storageCleanupFailed = true
    storageError = err
    console.warn(`[ExtensionWidgetService] Widget ${removedInstance.id} layout removed, but private storage cleanup failed.`, err)
  }

  return {
    success: true,
    stage: storageCleanupFailed ? 'storage' : 'done',
    removedInstance,
    updatedInstances,
    storageCleanupFailed,
    error: storageError,
  }
}

let isProcessingCleanups = false
/**
 * 自动重试未完成的组件私有存储清理任务（在扩展启动、网络恢复或会话切换时触发）
 */
export async function processPendingWidgetCleanups(): Promise<number> {
  if (isProcessingCleanups)
    return 0
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return 0

  isProcessingCleanups = true
  try {
    const prefs = readExtensionWidgets()
    const pending = prefs.pendingWidgetCleanupIds ?? []
    if (!pending.length)
      return 0

    const cleanedIds = new Set<string>()
    let cleanedCount = 0
    for (const id of pending) {
      if (!WIDGET_ID_PATTERN.test(id))
        continue
      try {
        const ok = await enqueueExtensionStorageSave(() => clearWidgetStorage(id))
        if (ok)
          cleanedIds.add(id)
      }
      catch {}
    }
    cleanedCount = cleanedIds.size

    if (cleanedCount > 0) {
      await updateExtensionWidgets(current => ({
        ...current,
        // Keep tasks appended by another removal while cleanup awaited.
        pendingWidgetCleanupIds: (current.pendingWidgetCleanupIds ?? []).filter(id => !cleanedIds.has(id)),
      })).catch(() => {})
    }
    return cleanedCount
  }
  finally {
    isProcessingCleanups = false
  }
}
