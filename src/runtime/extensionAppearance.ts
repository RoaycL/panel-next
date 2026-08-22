import { getRuntime } from '@/runtime'
import { WIDGET_ID_PATTERN, serializeWidgetLayout } from '@/widgets'
import type { WidgetInstance, WidgetLayout } from '@/widgets'
import { clearWidgetStorage } from '@/widgets/context'

export const EXTENSION_APPEARANCE_KEY = 'PANEL_NEXT_EXTENSION_APPEARANCE_V1'
export const EXTENSION_WIDGETS_KEY = 'PANEL_NEXT_EXTENSION_WIDGETS_V1'
const MAX_PENDING_WIDGET_CLEANUPS = 100

export interface ExtensionWidgetPreferences {
  clock: boolean
  search: boolean
  weather: boolean
  trending: boolean
  contentLayout: WidgetLayout
  pendingWidgetCleanupIds?: string[]
}

export const defaultExtensionWidgets: ExtensionWidgetPreferences = {
  clock: true,
  search: true,
  weather: true,
  trending: true,
  contentLayout: { schemaVersion: 1, widgets: [] },
  pendingWidgetCleanupIds: [],
}

function defaultWidgetPreferences(): ExtensionWidgetPreferences {
  return {
    ...defaultExtensionWidgets,
    contentLayout: { schemaVersion: 1, widgets: [] },
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

    runtime.storage.setItem(EXTENSION_APPEARANCE_KEY, serialized)
    try {
      await runtime.storage.flush?.()
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

    return {
      clock: parsed.clock !== false,
      search: parsed.search !== false,
      weather: parsed.weather !== false,
      trending: parsed.trending !== false,
      contentLayout,
      pendingWidgetCleanupIds: pendingCleanups,
    }
  }
  catch {
    return defaultWidgetPreferences()
  }
}

export function saveExtensionWidgets(preferences: ExtensionWidgetPreferences): Promise<boolean> {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return Promise.resolve(true)

  const snapshot = JSON.parse(JSON.stringify(preferences)) as ExtensionWidgetPreferences
  return updateExtensionWidgets(current => ({
    ...snapshot,
    // Cleanup tombstones are service-owned state. View models can be stale
    // because local adapter change echoes are intentionally suppressed,
    // so a regular layout save must never replace this queue.
    pendingWidgetCleanupIds: current.pendingWidgetCleanupIds ?? [],
  }))
}

export function updateExtensionWidgets(
  updater: (current: ExtensionWidgetPreferences) => ExtensionWidgetPreferences,
): Promise<boolean> {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return Promise.resolve(true)

  return enqueueExtensionStorageSave(async () => {
    const serialized = JSON.stringify(updater(readExtensionWidgets()))
    // 全局去重点：与已存储内容字节一致时跳过写入，避免多标签页循环触发
    if (runtime.storage.getItem(EXTENSION_WIDGETS_KEY) === serialized)
      return true

    runtime.storage.setItem(EXTENSION_WIDGETS_KEY, serialized)
    try {
      await runtime.storage.flush?.()
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
      return {
        ...storedPreferences,
        ...currentPreferences,
        contentLayout: nextLayout,
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
