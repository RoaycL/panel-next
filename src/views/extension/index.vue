<script setup lang="ts">
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NDropdown,
  NModal,
  NSwitch,
  useDialog,
  useMessage,
} from 'naive-ui'
import { t } from '@/locales'
import type { WidgetDisplayGroup } from '@/widgets/stack'
import type { WidgetInstance, WidgetSize } from '@/widgets/types'
import WidgetStackHost from '@/widgets/WidgetStackHost.vue'
import { generateWidgetInstanceId } from '@/widgets/builtins'
import { resizeInstanceToWithinBounds, resolveWidgetSize, serializeWidgetLayout, widgetRegistry } from '@/widgets/registry'
import { applyWidgetDisplayOrder, buildWidgetDisplayGroups, canStackWidgets, normalizeWidgetStacks, stackWidgets, unstackWidget } from '@/widgets/stack'
import { useWidgetGridResize } from '@/widgets/useGridResize'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import ItemIcon from '@/components/common/ItemIcon/index.vue'
import ProfileAvatar from '@/components/common/ProfileAvatar/index.vue'
import { useAppStore, useAuthStore, usePanelState, useUserStore } from '@/store'
import { getStorage as getAuthStorage } from '@/store/modules/auth/helper'
import type { AuthState } from '@/store/modules/auth'
import { getLocalState as getLocalUserState } from '@/store/modules/user/helper'
import { getLocalState as getLocalPanelState } from '@/store/modules/panel/helper'
import { VisitMode } from '@/enums/auth'
import { getRuntime } from '@/runtime'
import { extensionLoginVisible, openExtensionLogin } from '@/runtime/extensionLogin'
import type { StorageChangeEvent } from '@/runtime/types'
import { EXTENSION_APPEARANCE_KEY, EXTENSION_WIDGETS_KEY, processPendingWidgetCleanups, readExtensionAppearance, readExtensionWidgets, removeExtensionWidgetFlow, saveExtensionWidgets } from '@/runtime/extensionAppearance'
import { packageRevision } from '@/packages/manager'
import { useTheme } from '@/themes/context'
import { themeRegistry } from '@/themes/registry'
import { resolveThemeWallpaper } from '@/themes/wallpaper'
import { useLoadedWallpaper } from '@/runtime/wallpaperLoader'
import type { ExtensionBookmarkLayout, ExtensionPageLayout, ExtensionSearchEngineId } from '@/runtime/extensionAppearance'
import { enqueueAppearanceSave } from '@/themes/appearanceSaveQueue'
import { resolveSyncedWallpaper, saveAndSyncExtensionWallpaper } from '@/runtime/extensionWallpaper'
import { receiveSharedSettings, stageWidgetSettings } from '@/runtime/sharedSettings'
import ThemeIcon from '@/themes/ThemeIcon.vue'
import { BOOTSTRAP_SNAPSHOT_KEY_PREFIX, readBootstrapSnapshot, refreshBootstrapSnapshot } from '@/sync/bootstrapCache'
import { onSyncConflict, setSyncRevision } from '@/sync/revision'
import { replayOfflineQueue } from '@/sync/offlineReplay'
import { getPendingMutationCount, OFFLINE_QUEUE_KEY_PREFIX, onOfflineQueueChanged, readOfflineQueue } from '@/sync/offlineQueue'
import GroupIcon from '@/components/common/GroupIcon/index.vue'
import type { ConflictDescriptor, ConflictResolutionChoice } from '@/sync/conflictResolver'
import { getBootstrap, waitForSyncChange } from '@/api/sync'
import { getList as getGroupList } from '@/api/panel/itemIconGroup'
import { deletes as deleteItems, getListByGroupId, saveSort as saveItemSort } from '@/api/panel/itemIcon'
import type { DashboardGroup } from '@/dashboard/core'
import { createDashboardState, createItemSortRequest, isDesktopGroup, resolveItemUrl, sortDashboardGroups } from '@/dashboard/core'
import { rememberBootWallpaper } from '@/runtime/extension'
import SearchHistoryPanel from '@/components/common/SearchHistoryPanel.vue'
import { addSearchHistory } from '@/runtime/searchHistory'
import { VueDraggable } from 'vue-draggable-plus'
import { ICON_PRESETS, createPresetIcon } from '@/icons/presets'

import SvgSrcBaidu from '@/assets/search_engine_svg/baidu.svg'
import SvgSrcBing from '@/assets/search_engine_svg/bing.svg'
import SvgSrcGoogle from '@/assets/search_engine_svg/google.svg'

const UserHubModal = defineAsyncComponent(() => import('./components/UserHubModal.vue'))
const EditItem = defineAsyncComponent(() => import('@/views/home/components/EditItem/index.vue'))
const ItemGroupManage = defineAsyncComponent(() => import('@/components/apps/ItemGroupManage/index.vue'))
const GallerySelector = defineAsyncComponent(() => import('@/components/common/GallerySelector/index.vue'))
const WidgetSettingsModal = defineAsyncComponent(() => import('@/widgets/WidgetSettingsModal.vue'))
const IconGalleryModal = defineAsyncComponent(() => import('./components/IconGalleryModal.vue'))
const ConflictResolverModal = defineAsyncComponent(() => import('@/components/common/ConflictResolverModal/index.vue'))
const OfflineQueueManager = defineAsyncComponent(() => import('@/components/common/OfflineQueueManager/index.vue'))

const ms = useMessage()
const dialog = useDialog()
const appStore = useAppStore()
const panelState = usePanelState()
const wallpaperTheme = useTheme()
const requestedWallpaper = computed(() => {
  void packageRevision.value
  const url = resolveThemeWallpaper(wallpaperTheme.selection, themeRegistry.get(wallpaperTheme.themeId), wallpaperTheme.resolvedMode, panelState.panelConfig.backgroundImageSrc)
  return url ? getRuntime().resolveUrl(url) : ''
})
const { displayed: activeWallpaper, error: wallpaperLoadError } = useLoadedWallpaper(requestedWallpaper)
watch(wallpaperLoadError, error => { if (error) ms.warning(error) })
watch(() => [activeWallpaper.value, panelState.panelConfig.backgroundMaskNumber ?? 0.35] as const, ([url, mask]) => {
  rememberBootWallpaper(url, mask)
}, { immediate: true })
const authStore = useAuthStore()
const userStore = useUserStore()
const runtime = getRuntime()
const extensionProfileName = computed(() => authStore.userInfo?.name?.trim() || authStore.userInfo?.username?.trim() || '访客')
const extensionAvatarUrl = computed(() => runtime.resolveUrl(authStore.userInfo?.headImage?.trim() || ''))
if (!authStore.token && authStore.visitMode !== VisitMode.VISIT_MODE_PUBLIC)
  authStore.setVisitMode(VisitMode.VISIT_MODE_PUBLIC)

// 离线队列与冲突解决
const conflictModalVisible = ref(false)
const queueManagerVisible = ref(false)
const currentConflict = ref<ConflictDescriptor | null>(null)
let conflictResolverPromiseResolve: ((choice: ConflictResolutionChoice) => void) | null = null
let removeSyncConflictListener: (() => void) | null = null
let removeStorageListener: (() => void) | null = null
let removeOfflineQueueListener: (() => void) | null = null
let externalStorageTimer: number | null = null
let isDisposed = false
let syncWatchController: AbortController | null = null
let syncWatchRunning = false
const externalStorageKeys = new Set<string>()
const pendingMutationsCount = ref(0)

function refreshPendingMutationsCount() {
  const accountId = authStore.userInfo?.id
  pendingMutationsCount.value = accountId ? getPendingMutationCount(accountId) : 0
}

function onResolveConflict(choice: ConflictResolutionChoice) {
  if (conflictResolverPromiseResolve) {
    conflictResolverPromiseResolve(choice)
    conflictResolverPromiseResolve = null
  }
}

async function triggerOfflineReplay() {
  const accountId = authStore.userInfo?.id
  if (!accountId) return
  const result = await replayOfflineQueue(accountId, (conflict) => {
    currentConflict.value = conflict
    conflictModalVisible.value = true
    return new Promise<ConflictResolutionChoice>((resolve) => {
      conflictResolverPromiseResolve = resolve
    })
  })
  refreshPendingMutationsCount()
  if (result.succeeded > 0) {
    ms.success(`已成功同步 ${result.succeeded} 项离线修改`)
    void refreshBootstrap()
  }
  if (result.interrupted && result.error && navigator.onLine)
    ms.warning(`同步已暂停：${result.error}`)
}

const showWallpaperModal = ref(false)
const showWidgetManager = ref(false)
const showIconGallery = ref(false)
const addCenterSection = ref<'sites' | 'widgets'>('sites')
function openAddCenter(section: 'sites' | 'widgets' = 'sites') {
  addCenterSection.value = section
  showIconGallery.value = true
}
const showGroupManager = ref(false)
const widgetPreferences = ref(readExtensionWidgets())
const sidebarPosition = computed({
  get: () => widgetPreferences.value.sidebarPosition,
  set: (value: 'left' | 'right') => { widgetPreferences.value.sidebarPosition = value },
})
const sidebarAutoHide = computed({
  get: () => widgetPreferences.value.sidebarAutoHide,
  set: (value: boolean) => { widgetPreferences.value.sidebarAutoHide = value },
})
const sidebarWheelSwitch = computed({
  get: () => widgetPreferences.value.sidebarWheelSwitch,
  set: (value: boolean) => { widgetPreferences.value.sidebarWheelSwitch = value },
})
const sidebarDensity = computed({
  get: () => widgetPreferences.value.sidebarDensity,
  set: (value: 'compact' | 'comfortable') => { widgetPreferences.value.sidebarDensity = value },
})
const extensionClockEnabled = computed({
  get: () => widgetPreferences.value.clock,
  set: (value: boolean) => { widgetPreferences.value.clock = value },
})
const extensionClockSeconds = computed({
  get: () => widgetPreferences.value.clockSeconds,
  set: (value: boolean) => { widgetPreferences.value.clockSeconds = value },
})
const extensionClockDate = computed({
  get: () => widgetPreferences.value.clockDate,
  set: (value: boolean) => { widgetPreferences.value.clockDate = value },
})
const extensionClockHourCycle = computed({
  get: () => widgetPreferences.value.clockHourCycle,
  set: (value: '12' | '24') => { widgetPreferences.value.clockHourCycle = value },
})
const extensionSearchEnabled = computed({
  get: () => widgetPreferences.value.search,
  set: (value: boolean) => { widgetPreferences.value.search = value },
})
const extensionSearchOpenMode = computed({
  get: () => widgetPreferences.value.searchOpenMode,
  set: (value: 'current' | 'tab') => { widgetPreferences.value.searchOpenMode = value },
})
const extensionSearchHistoryEnabled = computed({
  get: () => widgetPreferences.value.searchHistoryEnabled,
  set: (value: boolean) => {
    widgetPreferences.value.searchHistoryEnabled = value
    if (!value) widgetPreferences.value.searchHistory = []
  },
})
const extensionWidgetInstances = ref<WidgetInstance[]>([])
const extensionQuarantinedWidgets = ref<unknown[]>([])
const extensionWidgetSettingsVisible = ref(false)
const extensionWidgetSettingsInstance = ref<WidgetInstance | null>(null)
const isRemovingWidget = ref(false)
const isWidgetLayoutDirty = ref(false)
const isPreviewingWidgetResize = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let loadedWidgetPageKey: string | null = null
let isLoadingWidgetPage = false
let widgetSaveGeneration = 0
const dirtyPageLayoutKeys = new Set<string>()

function emptyPageLayout(): ExtensionPageLayout {
  return { contentLayout: { schemaVersion: 1, widgets: [] }, itemOrder: [] }
}

function syncLoadedWidgetPageLayout(pageKey = loadedWidgetPageKey, markDirty = false) {
  if (!pageKey)
    return
  const current = widgetPreferences.value.pageLayouts[pageKey] ?? emptyPageLayout()
  widgetPreferences.value.pageLayouts = {
    ...widgetPreferences.value.pageLayouts,
    [pageKey]: {
      contentLayout: serializeWidgetLayout(extensionWidgetInstances.value, extensionQuarantinedWidgets.value),
      itemOrder: [...current.itemOrder],
    },
  }
  if (markDirty)
    dirtyPageLayoutKeys.add(pageKey)
}

async function persistExtensionWidgets(): Promise<boolean> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    syncLoadedWidgetPageLayout()
    const generation = widgetSaveGeneration
    const changedPageKeys = [...dirtyPageLayoutKeys]
    const success = await saveExtensionWidgets(widgetPreferences.value, changedPageKeys)
    if (success) {
      if (generation === widgetSaveGeneration) {
        dirtyPageLayoutKeys.clear()
        isWidgetLayoutDirty.value = false
      }
      return true
    }
    return false
  }
  catch (error) {
    isWidgetLayoutDirty.value = true
    console.error('Failed to persist extension widget layout.', error)
    ms.error(t('widgetLayout.saveFail'))
    return false
  }
}

function scheduleSaveExtensionWidgets(delay = 300) {
  stageWidgetSettings(widgetPreferences.value)
  widgetSaveGeneration += 1
  isWidgetLayoutDirty.value = true
  if (saveTimer)
    clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void persistExtensionWidgets()
  }, delay)
}

function flushPendingLayoutIfDirty() {
  if (isWidgetLayoutDirty.value) {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    void persistExtensionWidgets()
  }
}

function loadExtensionWidgetLayout(layout: unknown, pageKey: string) {
  isLoadingWidgetPage = true
  try {
    const result = widgetRegistry.loadLayout(layout)
    extensionWidgetInstances.value = result.layout.widgets
    extensionQuarantinedWidgets.value = result.quarantinedWidgets
    loadedWidgetPageKey = pageKey
    isWidgetLayoutDirty.value = false
    if (result.issues.length)
      console.warn('Quarantined incompatible extension widgets.', result.issues)
  }
  catch (error) {
    extensionWidgetInstances.value = []
    extensionQuarantinedWidgets.value = []
    loadedWidgetPageKey = pageKey
    isWidgetLayoutDirty.value = false
    console.warn('Invalid extension widget layout was ignored.', error)
  }
  finally {
    isLoadingWidgetPage = false
  }
}

// 防抖保存实例拖拽/缩放/隐藏/设置修改
watch(extensionWidgetInstances, () => {
  if (!isRemovingWidget.value && !isLoadingWidgetPage && !isPreviewingWidgetResize.value) {
    syncLoadedWidgetPageLayout(loadedWidgetPageKey, true)
    scheduleSaveExtensionWidgets(300)
  }
}, { deep: true, flush: 'sync' })

// 监听固定组件偏好开关
watch([
  () => widgetPreferences.value.clock,
  () => widgetPreferences.value.clockSeconds,
  () => widgetPreferences.value.clockDate,
  () => widgetPreferences.value.clockHourCycle,
  () => widgetPreferences.value.search,
  () => widgetPreferences.value.searchEngineId,
  () => widgetPreferences.value.searchOpenMode,
  () => widgetPreferences.value.searchHistoryEnabled,
  () => JSON.stringify(widgetPreferences.value.searchHistory),
  () => widgetPreferences.value.sidebarPosition,
  () => widgetPreferences.value.sidebarAutoHide,
  () => widgetPreferences.value.sidebarWheelSwitch,
  () => widgetPreferences.value.sidebarDensity,
], () => {
  scheduleSaveExtensionWidgets(150)
})

const extensionWidgetAddedCounts = computed(() => extensionWidgetInstances.value.reduce<Record<string, number>>((counts, instance) => {
  counts[instance.type] = (counts[instance.type] ?? 0) + 1
  return counts
}, {}))

function widgetDefinitionTitle(definition: { type: string, meta?: { title?: string } }) {
  const metaTitle = definition.meta?.title
  if (metaTitle) {
    const res = t(metaTitle)
    if (res && res !== metaTitle)
      return res
    return metaTitle
  }
  const typeKey = `widgetLayout.types.${definition.type}`
  const typeRes = t(typeKey)
  if (typeRes && typeRes !== typeKey)
    return typeRes
  return definition.type
}

const addingExtensionWidget = ref(false)

function restoreCurrentWidgetPageFromStorage() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  widgetSaveGeneration += 1
  const persisted = readExtensionWidgets()
  widgetPreferences.value.pageLayouts = persisted.pageLayouts
  widgetPreferences.value.contentLayout = persisted.contentLayout
  if (loadedWidgetPageKey) {
    loadExtensionWidgetLayout(persisted.pageLayouts[loadedWidgetPageKey]?.contentLayout ?? emptyPageLayout().contentLayout, loadedWidgetPageKey)
    dirtyPageLayoutKeys.delete(loadedWidgetPageKey)
  }
  isWidgetLayoutDirty.value = false
}

async function addExtensionWidget(type: string | number) {
  if (addingExtensionWidget.value)
    return
  addingExtensionWidget.value = true
  let inserted = false
  try {
    extensionWidgetInstances.value.push(widgetRegistry.create(String(type), generateWidgetInstanceId(String(type)), { column: 0, row: extensionWidgetInstances.value.length }))
    inserted = true
    isWidgetLayoutDirty.value = true
    if (await persistExtensionWidgets())
      ms.success(t('widgetGallery.addedMessage', { title: widgetDefinitionTitle(widgetRegistry.get(String(type)) ?? { type: String(type) }) }))
    else
      restoreCurrentWidgetPageFromStorage()
  }
  catch (error) {
    if (inserted)
      restoreCurrentWidgetPageFromStorage()
    ms.error(error instanceof Error ? error.message : t('widgetGallery.addFailed'))
  }
  finally {
    addingExtensionWidget.value = false
  }
}

function openExtensionWidgetSettings(instance: WidgetInstance) {
  extensionWidgetSettingsInstance.value = instance
  extensionWidgetSettingsVisible.value = true
}

function applyExtensionWidgetSettings(updated: WidgetInstance) {
  const index = extensionWidgetInstances.value.findIndex(instance => instance.id === updated.id)
  if (index >= 0) {
    extensionWidgetInstances.value[index] = updated
    isWidgetLayoutDirty.value = true
    void persistExtensionWidgets()
  }
}

const extensionWidgetEditMode = ref(false)
watch(extensionWidgetEditMode, (isEditing) => {
  if (!isEditing) {
    flushPendingLayoutIfDirty()
  }
})

const extensionWidgetGridRef = ref<HTMLElement | null>(null)
const {
  activeWidgetId: resizingExtensionWidgetId,
  startWidgetResize: startExtensionWidgetResize,
} = useWidgetGridResize({
  onStart: () => {
    // Pointermove only updates the visual preview. Serializing the complete
    // page layout on every pixel/grid step causes visible resize jank.
    isPreviewingWidgetResize.value = true
  },
  onPreview: () => {
    isWidgetLayoutDirty.value = true
  },
  async onCommit(instance, previous) {
    isWidgetLayoutDirty.value = true
    if (!await persistExtensionWidgets()) {
      instance.size = { ...previous }
      isWidgetLayoutDirty.value = true
    }
  },
  onFinish: () => {
    isPreviewingWidgetResize.value = false
  },
})

function toggleExtensionWidgetHidden(instance: WidgetInstance) {
  instance.hidden = !instance.hidden
  isWidgetLayoutDirty.value = true
  void persistExtensionWidgets()
}

function extensionWidgetStackTargetOptions(instance: WidgetInstance) {
  const seen = new Set<string>()
  return extensionWidgetInstances.value.flatMap((target) => {
    const key = target.stack?.id ?? target.id
    if (seen.has(key) || !canStackWidgets(extensionWidgetInstances.value, instance.id, target.id))
      return []
    seen.add(key)
    const count = target.stack ? extensionWidgetInstances.value.filter(candidate => candidate.stack?.id === target.stack?.id).length : 1
    return [{
      key: target.id,
      label: count > 1 ? `${widgetDefinitionTitle(widgetRegistry.get(target.type) ?? { type: target.type })} (${count})` : widgetDefinitionTitle(widgetRegistry.get(target.type) ?? { type: target.type }),
    }]
  })
}

function replaceActivePageOrderKeys(removedKeys: readonly string[], replacementKeys: readonly string[]) {
  const pageKey = loadedWidgetPageKey
  if (!pageKey)
    return
  const page = widgetPreferences.value.pageLayouts[pageKey] ?? emptyPageLayout()
  const removed = new Set(removedKeys)
  const insertionIndex = page.itemOrder.findIndex(key => removed.has(key))
  const nextOrder = page.itemOrder.filter(key => !removed.has(key) && !replacementKeys.includes(key))
  nextOrder.splice(insertionIndex < 0 ? nextOrder.length : insertionIndex, 0, ...replacementKeys)
  widgetPreferences.value.pageLayouts = {
    ...widgetPreferences.value.pageLayouts,
    [pageKey]: { ...page, itemOrder: nextOrder },
  }
}

function stackExtensionWidgetWith(instance: WidgetInstance, targetId: string | number) {
  const target = extensionWidgetInstances.value.find(candidate => candidate.id === String(targetId))
  if (!target)
    return
  const sourceKey = `widget:${instance.stack?.id ?? instance.id}`
  const targetKey = `widget:${target.stack?.id ?? target.id}`
  const stackId = stackWidgets(extensionWidgetInstances.value, instance.id, target.id)
  if (!stackId)
    return
  replaceActivePageOrderKeys([sourceKey, targetKey], [`widget:${stackId}`])
  extensionWidgetInstances.value = [...extensionWidgetInstances.value]
  isWidgetLayoutDirty.value = true
  void persistExtensionWidgets()
}

function removeExtensionWidgetFromStack(instance: WidgetInstance) {
  const previousStackId = instance.stack?.id
  if (!previousStackId || !unstackWidget(extensionWidgetInstances.value, instance.id))
    return
  const replacementKeys = buildWidgetDisplayGroups(extensionWidgetInstances.value, true)
    .filter(group => group.key === instance.id || group.members.some(member => member.stack?.id === previousStackId))
    .map(widgetCanvasKey)
  replaceActivePageOrderKeys([`widget:${previousStackId}`], replacementKeys)
  extensionWidgetInstances.value = [...extensionWidgetInstances.value]
  isWidgetLayoutDirty.value = true
  void persistExtensionWidgets()
}

function hasExtensionWidgetSettings(instance: WidgetInstance) {
  return Boolean(Object.keys(widgetRegistry.get(instance.type)?.configSchema.fields ?? {}).length)
}

function confirmRemoveExtensionWidget(index: number) {
  if (isRemovingWidget.value || index < 0 || index >= extensionWidgetInstances.value.length)
    return
  const target = extensionWidgetInstances.value[index]
  if (!target)
    return
  const targetTitle = widgetDefinitionTitle(widgetRegistry.get(target.type) ?? { type: target.type })
  dialog.warning({
    title: t('widgetLayout.removeConfirmTitle'),
    content: `${t('widgetLayout.removeConfirm')} (${targetTitle})`,
    positiveText: t('common.confirm') || '确定',
    negativeText: t('common.cancel') || '取消',
    onPositiveClick: async () => {
      await executeRemoveExtensionWidget(target.id)
    },
  })
}

async function executeRemoveExtensionWidget(instanceId: string) {
  if (isRemovingWidget.value)
    return
  isRemovingWidget.value = true
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  try {
    const result = await removeExtensionWidgetFlow(
      extensionWidgetInstances.value,
      instanceId,
      extensionQuarantinedWidgets.value,
      widgetPreferences.value,
      loadedWidgetPageKey ?? undefined,
    )

    if (!result.success) {
      // 布局保存失败：恢复 UI
      extensionWidgetInstances.value = result.updatedInstances
      ms.error(t('widgetLayout.saveFail'))
      return
    }

    // 布局保存成功：更新组件状态
    normalizeWidgetStacks(result.updatedInstances)
    extensionWidgetInstances.value = result.updatedInstances
    if (loadedWidgetPageKey) {
      const currentPage = widgetPreferences.value.pageLayouts[loadedWidgetPageKey] ?? emptyPageLayout()
      const knownWidgetKeys = new Set(buildWidgetDisplayGroups(result.updatedInstances, true).map(widgetCanvasKey))
      widgetPreferences.value.pageLayouts = {
        ...widgetPreferences.value.pageLayouts,
        [loadedWidgetPageKey]: {
          contentLayout: serializeWidgetLayout(result.updatedInstances, extensionQuarantinedWidgets.value),
          itemOrder: currentPage.itemOrder.filter(key => !key.startsWith('widget:') || knownWidgetKeys.has(key)),
        },
      }
    }

    if (result.storageCleanupFailed) {
      ms.warning(t('widgetLayout.storageCleanupFail'))
    }
    else {
      ms.success(t('widgetLayout.removeSuccess'))
    }
  }
  catch (error) {
    console.error('Failed to execute remove widget flow.', error)
    ms.error(t('widgetLayout.saveFail'))
  }
  finally {
    isRemovingWidget.value = false
  }
}

function extensionWidgetCellStyle(instance: { size: WidgetInstance['size'] }) {
  return {
    '--widget-columns': Math.min(12, Math.max(1, instance.size.columns)),
    gridColumn: `span ${Math.min(12, Math.max(1, instance.size.columns))}`,
    gridRow: `span ${Math.max(1, instance.size.rows)}`,
  }
}

async function handleWallpaperSelect(url: string) {
  const previousBg = panelState.panelConfig.backgroundImageSrc
  panelState.panelConfig.backgroundImageSrc = url
  // 经统一外观保存队列串行化，避免与主题/墙纸/布局整份写入交错覆盖。
  await enqueueAppearanceSave(async () => {
    try {
      const result = await saveAndSyncExtensionWallpaper(panelState.panelConfig)
      showWallpaperModal.value = false
      if (result.status === 'synced') ms.success('壁纸已保存并同步')
      else if (result.status === 'local') ms.success('壁纸已保存在本机，登录后可同步')
      else if (result.status === 'queued') ms.warning(result.message || '壁纸已保存，恢复连接后自动同步')
      else ms.warning(result.message || '壁纸已保存在本机，但云端同步失败，请重试')
      if (result.status === 'synced') void refreshBootstrap()
    }
    catch (error) {
      // Do not overwrite a newer appearance change that happened while this
      // save was awaiting extension storage.
      if (panelState.panelConfig.backgroundImageSrc === url)
        panelState.panelConfig.backgroundImageSrc = previousBg
      ms.error('保存壁纸设置失败，请重试')
      console.error('Failed to save wallpaper preference:', error)
    }
  })
}

// 1. 时钟与日期
const currentTime = ref('')
const currentSeconds = ref('')
const currentDate = ref('')
const currentPeriod = ref('')

let clockTimer: number | null = null

function updateClock() {
  const now = new Date()
  const rawHours = now.getHours()
  const displayHours = widgetPreferences.value.clockHourCycle === '12' ? rawHours % 12 || 12 : rawHours
  const hours = String(displayHours).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  currentTime.value = `${hours}:${minutes}`
  currentSeconds.value = seconds
  currentPeriod.value = widgetPreferences.value.clockHourCycle === '12' ? (rawHours >= 12 ? '下午' : '上午') : ''

  const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const date = now.getDate()
  const day = weekDays[now.getDay()]
  currentDate.value = `${year}年${month}月${date}日 · ${day}`

}

function stopClockTimer() {
  if (clockTimer !== null) {
    window.clearInterval(clockTimer)
    clockTimer = null
  }
}

function syncClockTimer() {
  stopClockTimer()
  if (!widgetPreferences.value.clock || document.hidden)
    return
  updateClock()
  clockTimer = window.setInterval(updateClock, 1000)
}

function handleVisibilityChange() {
  syncClockTimer()
  if (document.hidden) {
    syncWatchController?.abort()
  }
  else {
    void refreshBootstrap().then(startSyncWatch)
  }
}

watch([
  () => widgetPreferences.value.clock,
  () => widgetPreferences.value.clockHourCycle,
], syncClockTimer)

// 2. 聚合搜索引擎
interface SearchEngine {
  id: ExtensionSearchEngineId
  title: string
  url: string
  icon: string
  iconSrc?: string
}

const searchEngines: SearchEngine[] = [
  { id: 'baidu', title: '百度', url: 'https://www.baidu.com/s?wd=%s', icon: '', iconSrc: SvgSrcBaidu },
  { id: 'google', title: 'Google', url: 'https://www.google.com/search?q=%s', icon: '', iconSrc: SvgSrcGoogle },
  { id: 'bing', title: 'Bing', url: 'https://www.bing.com/search?q=%s', icon: '', iconSrc: SvgSrcBing },
  // Search selector icons use the bundled sprite directly. Bookmark favicons
  // below may still use Iconify, but core controls must remain visible offline.
  { id: 'github', title: 'GitHub', url: 'https://github.com/search?q=%s', icon: 'mdi-github' },
  { id: 'bilibili', title: 'Bilibili', url: 'https://search.bilibili.com/all?keyword=%s', icon: 'ri-bilibili-fill' },
  { id: 'duckduckgo', title: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', icon: 'simple-icons-duckduckgo' },
]

const currentEngine = computed<SearchEngine>(() => searchEngines.find(engine => engine.id === widgetPreferences.value.searchEngineId) ?? searchEngines[0])
const searchQuery = ref('')
const isSearchFocused = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
const searchHistoryPanelRef = ref<InstanceType<typeof SearchHistoryPanel> | null>(null)
const searchHistoryDismissed = ref(false)
function handleSearchFocusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) isSearchFocused.value = false
}
function selectSearchHistory(query: string) {
  searchQuery.value = query
  searchInputRef.value?.focus()
  searchHistoryDismissed.value = true
}
function dismissSearchHistory() {
  searchInputRef.value?.focus()
  searchHistoryDismissed.value = true
}
const bookmarkSearchOpen = ref(false)
const bookmarkSearchQuery = ref('')
const bookmarkSearchInputRef = ref<HTMLInputElement | null>(null)

interface BookmarkSearchResult {
  key: string
  groupTitle: string
  card: Panel.ItemInfo
}

const engineDropdownOptions = computed(() => {
  return searchEngines.map(e => ({
    label: e.title,
    key: e.id,
    icon: () => e.iconSrc
      ? h('img', { src: e.iconSrc, class: 'w-4 h-4' })
      : h(SvgIcon, { icon: e.icon, class: 'w-4 h-4 text-slate-700 dark:text-slate-200' }),
  }))
})

function handleSelectEngine(key: string) {
  const found = searchEngines.find(e => e.id === key)
  if (found)
    widgetPreferences.value.searchEngineId = found.id
}

function clearSearchHistory() {
  widgetPreferences.value.searchHistory = []
}

function directHttpUrl(query: string): string | null {
  if (/\s/.test(query))
    return null
  const explicitHttp = /^https?:\/\//i.test(query)
  const hostLike = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,})(?::\d+)?(?:[/?#]|$)/i.test(query)
  if (!explicitHttp && !hostLike)
    return null
  try {
    const url = new URL(explicitHttp ? query : `https://${query}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  }
  catch {
    return null
  }
}

function handleSearchSubmit() {
  const query = searchQuery.value.trim()
  if (!query)
    return
  if (widgetPreferences.value.searchHistoryEnabled) {
    widgetPreferences.value.searchHistory = addSearchHistory(widgetPreferences.value.searchHistory, query)
  }
  searchHistoryDismissed.value = true
  const targetUrl = directHttpUrl(query) ?? currentEngine.value.url.replace('%s', encodeURIComponent(query))
  runtime.openUrl(targetUrl, widgetPreferences.value.searchOpenMode)
}

function toggleBookmarkSearch() {
  bookmarkSearchOpen.value = !bookmarkSearchOpen.value
  if (bookmarkSearchOpen.value)
    void nextTick(() => bookmarkSearchInputRef.value?.focus())
}

function closeBookmarkSearch() {
  bookmarkSearchOpen.value = false
  bookmarkSearchQuery.value = ''
}

function openBookmarkSearchResult(card: Panel.ItemInfo) {
  closeBookmarkSearch()
  handleCardClick(card)
}

const featuredSiteIds = new Set(['baidu', 'google', 'bing', 'github', 'bilibili', 'youtube', 'chatgpt', 'cloudflare', 'docker', 'v2ex', 'claude', 'deepseek'])
const defaultPresetGroups: DashboardGroup[] = [
  {
    id: 1,
    title: '常用推荐',
    icon: '',
    sort: 1,
    hoverStatus: false,
    items: ICON_PRESETS.filter(preset => featuredSiteIds.has(preset.id)).map((preset, index) => ({
      id: 101 + index,
      title: preset.title,
      url: preset.url,
      description: preset.url,
      icon: createPresetIcon(preset),
      openMethod: 1,
      itemIconGroupId: 1,
    })),
  },
]

type ExtensionSyncStatus = 'idle' | 'syncing' | 'online' | 'cached' | 'offline' | 'error'
const extensionSyncStatus = ref<ExtensionSyncStatus>('syncing')
const syncRevision = ref<Sync.Revision>('0')
const extensionSyncPresentation = computed(() => {
  const states: Record<ExtensionSyncStatus, { label: string, tone: string }> = {
    idle: { label: '等待同步', tone: 'idle' },
    syncing: { label: '正在同步', tone: 'syncing' },
    online: { label: '已同步', tone: 'online' },
    cached: { label: '使用缓存', tone: 'cached' },
    offline: { label: '当前离线', tone: 'offline' },
    error: { label: '同步异常', tone: 'error' },
  }
  return states[extensionSyncStatus.value]
})
const groups = ref<DashboardGroup[]>(defaultPresetGroups)
// Until the user picks a page, startup and sync always land on the first group.
let followFirstGroup = true
function showPresetGroups() {
  followFirstGroup = true
  groups.value = defaultPresetGroups.map(group => ({ ...group, items: [...(group.items ?? [])] }))
}
const groupsReady = ref(!authStore.token)
const bookmarkSearchResults = computed<BookmarkSearchResult[]>(() => {
  const query = bookmarkSearchQuery.value.trim().toLowerCase()
  if (!query)
    return []
  return groups.value.flatMap(group => (group.items ?? [])
    .filter(card => card.title?.toLowerCase().includes(query)
      || card.description?.toLowerCase().includes(query)
      || card.url?.toLowerCase().includes(query))
    .map(card => ({
      key: `${group.id}:${card.id ?? card.title}`,
      groupTitle: group.title || '未命名分组',
      card,
    })))
    .slice(0, 12)
})
let isRefreshing = false

async function applyBootstrapData(data: Sync.BootstrapResponseV1) {
  if (isWidgetLayoutDirty.value && !await persistExtensionWidgets())
    return
  const dashboard = createDashboardState(data)
  setSyncRevision(dashboard.revision)
  syncRevision.value = dashboard.revision
  authStore.setUserInfo(dashboard.account)
  const sharedConfig = receiveSharedSettings(dashboard.panelConfig, dashboard.account.id, dashboard.revision)
  widgetPreferences.value = readExtensionWidgets()
  const localAppearance = sharedConfig.sharedPreferences ? null : readExtensionAppearance()
  // 统一外观入口：每个入口只在 store.applyPanelConfig 内部跑一次 preparePanelAppearance，
  // 并只在 Extension 端把清理/迁移后的配置写回 EXTENSION_APPEARANCE_KEY（自带字节去重）。
  let writeBack: Promise<boolean> | undefined
  if (localAppearance) {
    const syncedAppearance = resolveSyncedWallpaper(localAppearance, sharedConfig, dashboard.revision, dashboard.account.id)
    writeBack = panelState.applyPanelConfig(syncedAppearance, { surface: 'extension', mode: appStore.theme ?? 'auto', writeBack: true }).writeBack
  }
  else {
    // Use the cloud appearance only as a first-run starting point, then fork it
    // locally so later extension changes cannot overwrite the web appearance.
    writeBack = panelState.applyPanelConfig(sharedConfig, { surface: 'extension', mode: appStore.theme ?? 'auto', writeBack: true }).writeBack
  }
  authStore.setUserInfo(dashboard.account)
  authStore.setVisitMode(VisitMode.VISIT_MODE_LOGIN)
  userStore.updateUserInfo(dashboard.account)
  refreshPendingMutationsCount()
  groups.value = dashboard.groups || []
  // Preserve a queued icon choice while a cached/remote bootstrap refreshes.
  for (const mutation of readOfflineQueue(dashboard.account.id)) {
    if (mutation.action !== 'group.edit' || mutation.status === 'applied') continue
    const payload = mutation.payload as Panel.ItemIconGroup
    const group = groups.value.find(item => item.id === payload?.id)
    if (group && typeof payload.icon === 'string') group.icon = payload.icon
  }
  groupsReady.value = true
  const pageKey = readyPageLayoutKey.value
  if (pageKey)
    loadExtensionWidgetLayout(widgetPreferences.value.pageLayouts[pageKey]?.contentLayout ?? emptyPageLayout().contentLayout, pageKey)
  // 等待 Extension 回写真正持久化完成，失败时不假装同步成功。
  if (writeBack && (await writeBack) === false)
    extensionSyncStatus.value = 'offline'
}

async function refreshBootstrap() {
  if (isRefreshing) return
  if (!authStore.token) {
    authStore.setVisitMode(VisitMode.VISIT_MODE_PUBLIC)
    extensionSyncStatus.value = navigator.onLine ? 'idle' : 'offline'
    showPresetGroups()
    groupsReady.value = true
    return
  }
  isRefreshing = true
  extensionSyncStatus.value = 'syncing'
  try {
    // Authentication is background work: cached content has already painted.
    await authStore.upgradeLegacyExtensionSession()
    const expiry = Date.parse(authStore.accessExpiresAt ?? '')
    const needsUpgrade = new Date(authStore.refreshExpiresAt ?? '').getUTCFullYear() < 9999
    if (authStore.authMode === 'device' && authStore.token && (!Number.isFinite(expiry) || expiry - Date.now() < 60_000 || needsUpgrade))
      await authStore.refreshSession()
    if (!authStore.token) {
      showPresetGroups()
      groupsReady.value = true
      extensionSyncStatus.value = 'idle'
      return
    }
    const accountId = authStore.userInfo?.id
    if (accountId) {
      const result = await refreshBootstrapSnapshot(accountId)
      if (result.data) {
        await applyBootstrapData(result.data)
        extensionSyncStatus.value = 'online'
        return
      }
    }
    const bootstrapRes = await getBootstrap()
    if (bootstrapRes.code === 0 && bootstrapRes.data) {
      await applyBootstrapData(bootstrapRes.data)
      extensionSyncStatus.value = 'online'
      return
    }
    // 降级使用普通 API 获取
    if (!authStore.token) {
      authStore.setVisitMode(VisitMode.VISIT_MODE_PUBLIC)
      showPresetGroups()
      groupsReady.value = true
      extensionSyncStatus.value = navigator.onLine ? 'idle' : 'offline'
      return
    }
    if (await loadDirectFromApi())
      extensionSyncStatus.value = 'online'
    else
      await loadCachedSnapshot()
  }
  catch {
    await loadCachedSnapshot()
  }
  finally {
    isRefreshing = false
  }
}

/** Hold one bounded request while visible; the server only sends a revision.
 * Missed notifications are harmless because refreshBootstrap replays changes
 * from the last durable snapshot cursor after reconnect/focus. */
async function startSyncWatch() {
  if (syncWatchRunning || isDisposed || document.hidden || !authStore.token || !authStore.userInfo?.id)
    return
  syncWatchRunning = true
  try {
    while (true) {
      if (isDisposed || document.hidden || !authStore.token || !authStore.userInfo?.id)
        break
      const accountId: number = authStore.userInfo.id
      const controller = new AbortController()
      syncWatchController = controller
      try {
        const response = await waitForSyncChange(syncRevision.value, controller.signal)
        if (controller.signal.aborted || isDisposed || authStore.userInfo?.id !== accountId)
          break
        if (response.code !== 0) {
          await new Promise(resolve => window.setTimeout(resolve, 10_000))
          if (!isDisposed && !document.hidden)
            await refreshBootstrap()
          continue
        }
        if (response.data?.changed && response.data.revision !== syncRevision.value) {
          await refreshBootstrap()
          // A local save may already be refreshing this page. Avoid a hot
          // reconnect loop until that refresh applies the new cursor.
          if (response.data.revision !== syncRevision.value)
            await new Promise(resolve => window.setTimeout(resolve, 750))
        }
      }
      catch {
        if (controller.signal.aborted || isDisposed || document.hidden)
          break
        await new Promise(resolve => window.setTimeout(resolve, 10_000))
        if (!isDisposed && !document.hidden)
          await refreshBootstrap()
      }
      finally {
        if (syncWatchController === controller)
          syncWatchController = null
      }
    }
  }
  finally {
    syncWatchRunning = false
    if (!isDisposed && !document.hidden && authStore.token)
      void startSyncWatch()
  }
}

async function loadCachedSnapshot() {
  const accountId = authStore.userInfo?.id
  const cached = accountId ? readBootstrapSnapshot(accountId) : null
  if (cached?.data) {
    await applyBootstrapData(cached.data)
    if (extensionSyncStatus.value !== 'offline')
      extensionSyncStatus.value = navigator.onLine ? 'cached' : 'offline'
  }
  else {
    extensionSyncStatus.value = 'error'
  }
}

async function loadDirectFromApi() {
  const groupRes = await getGroupList<Panel.ItemIconGroup[]>()
  if (groupRes.code !== 0 || !Array.isArray(groupRes.data))
    return false

  const results = await Promise.all(groupRes.data.map(async (g) => {
    const itemsRes = await getListByGroupId<Panel.ItemInfo[]>(g.id)
    if (itemsRes.code !== 0 || !Array.isArray(itemsRes.data))
      return null
    return {
        id: g.id ?? 0,
        title: g.title ?? '',
        icon: g.icon,
        // Missing sort stays missing so ordering puts it last, as in bootstrap.
        sort: g.sort,
        hoverStatus: false,
        items: itemsRes.data,
      } satisfies DashboardGroup
  }))
  if (results.some(group => group === null))
    return false
  groups.value = sortDashboardGroups(results as DashboardGroup[])
  groupsReady.value = true
  return true
}

// 5. 分组 Tab 切换与卡片过滤（告别堆叠）
const activeTabId = ref<number | null>(null)
const groupSlideDirection = ref<'next' | 'previous'>('next')
const sideRailRevealed = ref(!sidebarAutoHide.value)
const wheelHintVisible = ref(false)
const settingsModalVisible = ref(false)
const editCardModalVisible = ref(false)
const editCardData = ref<Panel.ItemInfo | null>(null)
const editCardGroupId = ref<number | undefined>(undefined)
let wheelLocked = false
let wheelLockTimer: number | null = null
let wheelHintTimer: number | null = null
let suppressNextCardClick = false
let suppressCardClickTimer: number | null = null
let bookmarkSortSnapshot: Panel.ItemInfo[] | null = null
let dashboardOrderSnapshot: string[] | null = null
let sideHideTimer: number | null = null

const sideRailElement = ref<HTMLElement | null>(null)
const sideRailSuppressed = computed(() => settingsModalVisible.value || extensionLoginVisible.value
  || showWallpaperModal.value || showWidgetManager.value
  || showIconGallery.value || showGroupManager.value || extensionWidgetSettingsVisible.value || editCardModalVisible.value
  || conflictModalVisible.value || queueManagerVisible.value)
const sideRailVisible = computed(() => !sideRailSuppressed.value && (!sidebarAutoHide.value || sideRailRevealed.value))

function clearSideHideTimer() {
  if (sideHideTimer) {
    window.clearTimeout(sideHideTimer)
    sideHideTimer = null
  }
}

function revealSideArea() {
  if (sideRailSuppressed.value)
    return
  clearSideHideTimer()
  sideRailRevealed.value = true
}

function scheduleSideAreaHide() {
  clearSideHideTimer()
  sideHideTimer = window.setTimeout(() => {
    const keyboardFocusWithin = sideRailElement.value?.contains(document.activeElement)
      && document.activeElement?.matches(':focus-visible')
    if (sidebarAutoHide.value && !keyboardFocusWithin)
      sideRailRevealed.value = false
    sideHideTimer = null
  }, 260)
}

function closeSideArea() {
  clearSideHideTimer()
  if (sidebarAutoHide.value)
    sideRailRevealed.value = false
}

watch(sidebarAutoHide, (hidden) => {
  clearSideHideTimer()
  sideRailRevealed.value = !hidden
  if (hidden)
    scheduleSideAreaHide()
})

watch(sidebarPosition, () => {
  closeSideArea()
})

watch(sideRailSuppressed, (suppressed) => {
  if (suppressed) {
    clearSideHideTimer()
    sideRailRevealed.value = false
  }
}, { flush: 'sync' })

const groupTabs = computed(() => {
  return groups.value.filter(isDesktopGroup).map(g => ({
    id: g.id as number,
    title: g.title || '',
    count: g.items?.length || 0,
    icon: g.icon,
  }))
})

const activeGroup = computed(() => groupTabs.value.find(group => group.id === activeTabId.value) || groupTabs.value[0])
const activeGroupRecord = computed(() => groups.value.find(group => isDesktopGroup(group) && group.id === activeTabId.value) ?? groups.value.find(isDesktopGroup) ?? null)
const activeGroupItems = computed<Panel.ItemInfo[]>({
  get: () => activeGroupRecord.value?.items ?? [],
  set: (items) => {
    const group = activeGroupRecord.value
    if (!group)
      return
    group.items = items
    groups.value = [...groups.value]
  },
})
const activePageLayoutKey = computed(() => {
  const groupId = activeGroupRecord.value?.id
  if (!Number.isSafeInteger(Number(groupId)) || Number(groupId) < 0)
    return null
  return `${authStore.userInfo?.id ?? 'guest'}:${groupId}`
})
const readyPageLayoutKey = computed(() => groupsReady.value ? activePageLayoutKey.value : null)

type ExtensionCanvasItem =
  | { key: string, kind: 'bookmark', card: Panel.ItemInfo }
  | { key: string, kind: 'widget', group: WidgetDisplayGroup }

function bookmarkCanvasKey(card: Panel.ItemInfo) {
  return `bookmark:${card.id}`
}

function widgetCanvasKey(group: WidgetDisplayGroup) {
  return `widget:${group.key}`
}

function orderedCanvasItems(items: ExtensionCanvasItem[], savedOrder: readonly string[]) {
  const byKey = new Map(items.map(item => [item.key, item]))
  const ordered = savedOrder.flatMap(key => byKey.get(key) ?? [])
  const seen = new Set(ordered.map(item => item.key))
  return [...ordered, ...items.filter(item => !seen.has(item.key))]
}

const activeCanvasItems = computed<ExtensionCanvasItem[]>({
  get: () => {
    const pageKey = readyPageLayoutKey.value
    const widgetGroups = buildWidgetDisplayGroups(extensionWidgetInstances.value, extensionWidgetEditMode.value)
      .map(group => ({ key: widgetCanvasKey(group), kind: 'widget' as const, group }))
    const bookmarks = activeGroupItems.value
      .map(card => ({ key: bookmarkCanvasKey(card), kind: 'bookmark' as const, card }))
    const savedOrder = pageKey ? widgetPreferences.value.pageLayouts[pageKey]?.itemOrder ?? [] : []
    return orderedCanvasItems([...widgetGroups, ...bookmarks], savedOrder)
  },
  set: (items) => {
    const pageKey = readyPageLayoutKey.value
    if (!pageKey)
      return
    const visibleKeys = items.map(item => item.key)
    const allWidgetKeys = buildWidgetDisplayGroups(extensionWidgetInstances.value, true).map(widgetCanvasKey)
    const preservedKeys = (widgetPreferences.value.pageLayouts[pageKey]?.itemOrder ?? [])
      .filter(key => !visibleKeys.includes(key) && allWidgetKeys.includes(key))
    widgetPreferences.value.pageLayouts = {
      ...widgetPreferences.value.pageLayouts,
      [pageKey]: {
        contentLayout: widgetPreferences.value.pageLayouts[pageKey]?.contentLayout ?? { schemaVersion: 1, widgets: [] },
        itemOrder: [...visibleKeys, ...preservedKeys],
      },
    }

    const orderedBookmarks = items.flatMap(item => item.kind === 'bookmark' ? [item.card] : [])
    if (orderedBookmarks.length === activeGroupItems.value.length)
      activeGroupItems.value = orderedBookmarks
    const orderedWidgetKeys = items.flatMap(item => item.kind === 'widget' ? [item.group.key] : [])
    if (orderedWidgetKeys.length)
      applyWidgetDisplayOrder(extensionWidgetInstances.value, orderedWidgetKeys)
    extensionWidgetInstances.value = [...extensionWidgetInstances.value]
    syncLoadedWidgetPageLayout(pageKey, true)
    isWidgetLayoutDirty.value = true
  },
})
const bookmarkLayoutChoices: readonly ExtensionBookmarkLayout[] = [
  { columns: 1, rows: 1 },
  { columns: 1, rows: 2 },
  { columns: 2, rows: 1 },
  { columns: 2, rows: 2 },
  { columns: 2, rows: 4 },
]

function bookmarkLayoutKey(card: Panel.ItemInfo) {
  if (!Number.isSafeInteger(card.id) || Number(card.id) <= 0)
    return null
  return `${authStore.userInfo?.id ?? 'guest'}:${card.id}`
}

function bookmarkLayout(card: Panel.ItemInfo): ExtensionBookmarkLayout {
  const key = bookmarkLayoutKey(card)
  return key ? widgetPreferences.value.bookmarkLayouts[key] ?? { columns: 1, rows: 1 } : { columns: 1, rows: 1 }
}

function bookmarkCardStyle(card: Panel.ItemInfo) {
  const layout = bookmarkLayout(card)
  return {
    '--bookmark-columns': layout.columns,
    gridColumn: `span ${layout.columns}`,
    gridRow: `span ${layout.rows}`,
  }
}

function setBookmarkLayout(card: Panel.ItemInfo, layout: ExtensionBookmarkLayout) {
  const key = bookmarkLayoutKey(card)
  if (!key)
    return
  widgetPreferences.value.bookmarkLayouts = {
    ...widgetPreferences.value.bookmarkLayouts,
    [key]: { ...layout },
  }
  scheduleSaveExtensionWidgets(0)
}

watch(groupTabs, (tabs) => {
  if (!tabs.length) {
    activeTabId.value = null
    return
  }
  // The preset page shares id 1 with many accounts' first-created group, so an
  // existing id alone does not mean the user chose it.
  if (followFirstGroup || !tabs.some(tab => tab.id === activeTabId.value))
    activeTabId.value = tabs[0].id
}, { immediate: true })

watch(readyPageLayoutKey, (pageKey) => {
  if (!pageKey)
    return
  if (loadedWidgetPageKey && loadedWidgetPageKey !== pageKey)
    syncLoadedWidgetPageLayout(loadedWidgetPageKey)

  let pageLayout = widgetPreferences.value.pageLayouts[pageKey]
  const legacyLayout = widgetPreferences.value.contentLayout
  const shouldMigrateLegacy = !pageLayout && legacyLayout.widgets.length > 0
  if (shouldMigrateLegacy) {
    pageLayout = { contentLayout: legacyLayout, itemOrder: [] }
    widgetPreferences.value.pageLayouts = {
      ...widgetPreferences.value.pageLayouts,
      [pageKey]: pageLayout,
    }
    widgetPreferences.value.contentLayout = { schemaVersion: 1, widgets: [] }
    dirtyPageLayoutKeys.add(pageKey)
  }

  loadExtensionWidgetLayout(pageLayout?.contentLayout ?? emptyPageLayout().contentLayout, pageKey)
  if (shouldMigrateLegacy)
    scheduleSaveExtensionWidgets(0)
}, { immediate: true })

watch(packageRevision, () => {
  if (isWidgetLayoutDirty.value)
    return
  const pageKey = readyPageLayoutKey.value
  if (pageKey)
    loadExtensionWidgetLayout(widgetPreferences.value.pageLayouts[pageKey]?.contentLayout ?? emptyPageLayout().contentLayout, pageKey)
})

function selectGroup(id: number, direction?: 'next' | 'previous') {
  if (id === activeTabId.value || !groupTabs.value.some(group => group.id === id))
    return
  const currentIndex = groupTabs.value.findIndex(group => group.id === activeTabId.value)
  const nextIndex = groupTabs.value.findIndex(group => group.id === id)
  groupSlideDirection.value = direction ?? (nextIndex >= currentIndex ? 'next' : 'previous')
  followFirstGroup = false
  activeTabId.value = id
}

function openGroupManager() {
  if (authStore.visitMode !== VisitMode.VISIT_MODE_LOGIN) {
    ms.info('登录后可新增和管理分组')
    return
  }
  showGroupManager.value = true
}

function closeGroupManager() {
  showGroupManager.value = false
  void refreshBootstrap()
}

function handleGroupWheel(event: WheelEvent) {
  if (!widgetPreferences.value.sidebarWheelSwitch)
    return
  if (settingsModalVisible.value || showWallpaperModal.value || showWidgetManager.value || showIconGallery.value || editCardModalVisible.value || conflictModalVisible.value)
    return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, [role="dialog"], .side-panel-scroll, .search-history-panel'))
    return
  if (Math.abs(event.deltaY) < 18 || wheelLocked || groupTabs.value.length < 2)
    return

  const scrollContainer = target?.closest('.main-content') as HTMLElement | null
  if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
    const atTop = scrollContainer.scrollTop <= 1
    const atBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 1
    if ((event.deltaY < 0 && !atTop) || (event.deltaY > 0 && !atBottom))
      return
  }

  event.preventDefault()
  const currentIndex = Math.max(0, groupTabs.value.findIndex(group => group.id === activeTabId.value))
  const direction = event.deltaY > 0 ? 1 : -1
  const nextIndex = (currentIndex + direction + groupTabs.value.length) % groupTabs.value.length
  selectGroup(groupTabs.value[nextIndex].id, direction > 0 ? 'next' : 'previous')
  wheelHintVisible.value = true
  wheelLocked = true
  wheelLockTimer = window.setTimeout(() => { wheelLocked = false; wheelLockTimer = null }, 420)
  if (wheelHintTimer) window.clearTimeout(wheelHintTimer)
  wheelHintTimer = window.setTimeout(() => { wheelHintVisible.value = false }, 1100)
}

// 点击卡片在浏览器新标签页打开
async function handleCardClick(card: Panel.ItemInfo) {
  if (suppressNextCardClick) {
    suppressNextCardClick = false
    return
  }
  const targetUrl = await resolveItemUrl(card, panelState.networkMode)
  if (targetUrl)
    runtime.openUrl(targetUrl, 'tab')
}

function openCardEditor(card: Panel.ItemInfo) {
  if (authStore.visitMode !== VisitMode.VISIT_MODE_LOGIN)
    return
  editCardData.value = { ...card }
  editCardGroupId.value = card.itemIconGroupId || 0
  editCardModalVisible.value = true
}

function goToIconLogin() {
  showIconGallery.value = false
  openExtensionLogin()
}

function handleBookmarkDragStart() {
  bookmarkSortSnapshot = activeGroupItems.value.map(item => ({ ...item }))
  dashboardOrderSnapshot = activeCanvasItems.value.map(item => item.key)
  suppressCardClickAfterDrag()
}

function suppressCardClickAfterDrag() {
  suppressNextCardClick = true
  if (suppressCardClickTimer)
    window.clearTimeout(suppressCardClickTimer)
  suppressCardClickTimer = window.setTimeout(() => {
    suppressNextCardClick = false
  }, 400)
}

async function handleBookmarkDragEnd() {
  suppressCardClickAfterDrag()
  const group = activeGroupRecord.value
  const snapshot = bookmarkSortSnapshot
  const orderSnapshot = dashboardOrderSnapshot
  bookmarkSortSnapshot = null
  dashboardOrderSnapshot = null
  if (!group || !snapshot)
    return

  const restoreDashboardOrder = () => {
    group.items = snapshot
    if (orderSnapshot && readyPageLayoutKey.value) {
      const pageKey = readyPageLayoutKey.value
      const page = widgetPreferences.value.pageLayouts[pageKey] ?? emptyPageLayout()
      widgetPreferences.value.pageLayouts = {
        ...widgetPreferences.value.pageLayouts,
        [pageKey]: { ...page, itemOrder: orderSnapshot },
      }
    }
    groups.value = [...groups.value]
  }

  if (!await persistExtensionWidgets()) {
    restoreDashboardOrder()
    return
  }

  // Guest bookmarks are presets. Their visual order is local-only, just like
  // guest widgets, so there is no account mutation to send to the server.
  if (authStore.visitMode !== VisitMode.VISIT_MODE_LOGIN || !authStore.token)
    return

  const bookmarkOrderChanged = snapshot.some((item, index) => item.id !== group.items[index]?.id)
  if (!bookmarkOrderChanged)
    return
  group.items.forEach((item, index) => { item.sort = index + 1 })
  const request = createItemSortRequest(group)
  if (!request) {
    restoreDashboardOrder()
    return
  }
  try {
    const response = await saveItemSort(request)
    if (response.code !== 0) {
      restoreDashboardOrder()
      void persistExtensionWidgets()
      ms.error(`${t('common.saveFail')}: ${response.msg}`)
    }
    else if (response.queued) {
      ms.info(response.msg)
    }
  }
  catch (error) {
    restoreDashboardOrder()
    void persistExtensionWidgets()
    ms.error(`${t('common.saveFail')}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// 6. 右键菜单与快捷操作
const activeRightCard = ref<Panel.ItemInfo | null>(null)
const rightMenuShow = ref(false)
const activeRightWidget = ref<WidgetInstance | null>(null)
const widgetRightMenuShow = ref(false)
const rightMenuX = ref(0)
const rightMenuY = ref(0)
const bookmarkContextMenuRef = ref<HTMLElement | null>(null)
const widgetContextMenuRef = ref<HTMLElement | null>(null)
let contextMenuReturnFocus: HTMLElement | null = null

function positionContextMenu(event: MouseEvent, estimatedWidth = 252, estimatedHeight = 340) {
  let x = event.clientX
  let y = event.clientY
  // Keyboard-activated buttons dispatch click events at (0, 0). Anchor the
  // menu to the focused control instead of unexpectedly opening top-left.
  if (x === 0 && y === 0 && event.currentTarget instanceof HTMLElement) {
    const rect = event.currentTarget.getBoundingClientRect()
    x = rect.left + Math.min(rect.width / 2, 48)
    y = rect.top + Math.min(rect.height, 48)
  }
  rightMenuX.value = Math.max(10, Math.min(x, window.innerWidth - estimatedWidth - 10))
  rightMenuY.value = Math.max(10, Math.min(y, window.innerHeight - estimatedHeight - 10))
}

function handleCardContextMenu(event: MouseEvent, card: Panel.ItemInfo) {
  event.preventDefault()
  contextMenuReturnFocus = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  activeRightCard.value = card
  activeRightWidget.value = null
  widgetRightMenuShow.value = false
  positionContextMenu(event)
  rightMenuShow.value = true
  void nextTick(() => bookmarkContextMenuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
}

function handleWidgetContextMenu(event: MouseEvent, instance: WidgetInstance) {
  event.preventDefault()
  contextMenuReturnFocus = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  activeRightWidget.value = instance
  activeRightCard.value = null
  rightMenuShow.value = false
  positionContextMenu(event, 280, 360)
  widgetRightMenuShow.value = true
  void nextTick(() => widgetContextMenuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
}

function openCardContextMenuFromKeyboard(event: KeyboardEvent, card: Panel.ItemInfo) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
    return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  handleCardContextMenu(new MouseEvent('contextmenu', { clientX: rect.left + Math.min(rect.width / 2, 48), clientY: rect.top + Math.min(rect.height / 2, 48) }), card)
  contextMenuReturnFocus = target
}

function openWidgetContextMenuFromKeyboard(event: KeyboardEvent, instance: WidgetInstance) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
    return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  handleWidgetContextMenu(new MouseEvent('contextmenu', { clientX: rect.left + Math.min(rect.width / 2, 48), clientY: rect.top + Math.min(rect.height / 2, 48) }), instance)
  contextMenuReturnFocus = target
}

function handleContextMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeContextMenus()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
    return
  const menu = event.currentTarget as HTMLElement
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')]
  if (!items.length)
    return
  event.preventDefault()
  const currentIndex = items.indexOf(document.activeElement as HTMLElement)
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? items.length - 1
      : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[nextIndex]?.focus()
}

function closeContextMenus(restoreFocus = true) {
  rightMenuShow.value = false
  widgetRightMenuShow.value = false
  if (restoreFocus && contextMenuReturnFocus) {
    const target = contextMenuReturnFocus
    contextMenuReturnFocus = null
    void nextTick(() => target.focus())
  }
}

const activeWidgetSizeChoices = computed<WidgetSize[]>(() => {
  const instance = activeRightWidget.value
  const definition = instance ? widgetRegistry.get(instance.type) : null
  if (!instance || !definition || instance.stack || definition.size.resize === 'none')
    return []
  const requested = [
    instance.size,
    definition.size.min,
    definition.size.default,
    definition.size.max,
    { columns: 1, rows: 1 },
    { columns: 1, rows: 2 },
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
    { columns: 2, rows: 4 },
    { columns: 3, rows: 1 },
    { columns: 3, rows: 2 },
    { columns: 4, rows: 2 },
    { columns: 6, rows: 2 },
    { columns: 12, rows: 2 },
  ]
  const candidates = definition.size.supportedSizes?.length ? definition.size.supportedSizes : requested
  const unique = new Map<string, WidgetSize>()
  for (const candidate of candidates) {
    const resolved = resolveWidgetSize(instance.type, candidate)
    if (!resolved)
      continue
    const trial: WidgetInstance = { ...instance, size: { ...instance.size }, config: instance.config }
    resizeInstanceToWithinBounds(trial, resolved)
    unique.set(`${trial.size.columns}x${trial.size.rows}`, { ...trial.size })
  }
  return [...unique.values()]
    .sort((left, right) => left.columns * left.rows - right.columns * right.rows || left.columns - right.columns)
    .slice(0, 10)
})

function setActiveWidgetSize(size: WidgetSize) {
  const instance = activeRightWidget.value
  if (!instance)
    return
  if (resizeInstanceToWithinBounds(instance, size)) {
    extensionWidgetInstances.value = [...extensionWidgetInstances.value]
    scheduleSaveExtensionWidgets(0)
  }
}

function openActiveWidgetSettings() {
  const instance = activeRightWidget.value
  closeContextMenus()
  if (instance && hasExtensionWidgetSettings(instance))
    openExtensionWidgetSettings(instance)
}

function removeActiveWidgetFromMenu() {
  const instance = activeRightWidget.value
  closeContextMenus()
  if (instance)
    void confirmRemoveExtensionWidget(extensionWidgetInstances.value.indexOf(instance))
}

async function handleRightMenuSelect(key: string) {
  closeContextMenus()
  const card = activeRightCard.value
  if (!card) return

  if (key === 'open_tab') {
    handleCardClick(card)
  }
  else if (key === 'open_lan' && card.lanUrl) {
    runtime.openUrl(card.lanUrl, 'tab')
  }
  else if (key === 'edit') {
    openCardEditor(card)
  }
  else if (key === 'edit_home') {
    openGroupManager()
  }
  else if (key === 'delete' && card.id) {
    dialog.warning({
      title: '删除书签',
      content: `确定删除“${card.title}”吗？`,
      positiveText: t('common.confirm'),
      negativeText: t('common.cancel'),
      onPositiveClick: async () => {
        const response = await deleteItems([card.id as number])
        if (response.code !== 0) {
          ms.error(`${t('common.deleteFail')}: ${response.msg}`)
          return
        }
        for (const group of groups.value)
          group.items = (group.items ?? []).filter(item => item.id !== card.id)
        groups.value = [...groups.value]
        if (response.queued)
          ms.info(response.msg)
        else
          ms.success(t('common.deleteSuccess'))
      },
    })
  }
}

// 7. 内置系统与扩展设置模态框（In-Extension Settings Modal，无需跳出）
function openSettings() {
  settingsModalVisible.value = true
}

function handleAvatarClick() {
  if (!authStore.token) {
    openExtensionLogin()
    return
  }
  openSettings()
}

function handleEditSuccess(updated: Panel.Info, meta: { queued: boolean } = { queued: false }) {
  editCardModalVisible.value = false
  const updatedItem = updated as Panel.ItemInfo
  const targetGroup = groups.value.find(group => group.id === updatedItem.itemIconGroupId)
  const existingIndex = targetGroup?.items?.findIndex(item => item.id === updatedItem.id) ?? -1
  for (const group of groups.value) {
    if (group !== targetGroup)
      group.items = (group.items || []).filter(item => item.id !== updatedItem.id)
  }
  if (targetGroup && existingIndex >= 0)
    targetGroup.items.splice(existingIndex, 1, updatedItem)
  else if (targetGroup) {
    targetGroup.items.push(updatedItem)
    targetGroup.items.sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999) || (a.createTime ?? '').localeCompare(b.createTime ?? '') || (a.id ?? 0) - (b.id ?? 0))
  }
  // Keep the optimistic local edit visible while it waits in the durable
  // queue. A replay or remote storage update will refresh the snapshot later.
  if (!meta.queued)
    void refreshBootstrap()
}

function handleGroupIconSaved(updated: Panel.ItemIconGroup, meta: { queued: boolean }) {
  const group = groups.value.find(item => item.id === updated.id)
  if (group) group.icon = updated.icon
  if (!meta.queued) void refreshBootstrap()
}

function handleGroupOrderSaved(ids: number[], meta: { queued: boolean }) {
  const positions = new Map(ids.map((id, index) => [id, index + 1]))
  groups.value.forEach(group => { group.sort = positions.get(group.id as number) ?? group.sort })
  groups.value = [...groups.value].sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999))
  if (!meta.queued) void refreshBootstrap()
}

function handleBrowserOffline() {
  extensionSyncStatus.value = 'offline'
}

async function handleBrowserOnline() {
  await processPendingWidgetCleanups()
  await triggerOfflineReplay()
  await refreshBootstrap()
}

async function applyExternalStorageChanges() {
  externalStorageTimer = null
  const keys = [...externalStorageKeys]
  externalStorageKeys.clear()

  if (keys.includes(EXTENSION_APPEARANCE_KEY)) {
    const appearance = readExtensionAppearance()
    if (appearance) {
      // 等待回写 promise，失败时同步状态不假装成功。
      const writeBack = panelState.applyPanelConfig(appearance, { surface: 'extension', mode: appStore.theme ?? 'auto', writeBack: true }).writeBack
      if (writeBack && (await writeBack) === false)
        extensionSyncStatus.value = 'offline'
    }
  }
  if (keys.includes(EXTENSION_WIDGETS_KEY)) {
    // Do not silently replace an unsaved pointer/drag change with another
    // tab's storage notification. Page-scoped writes merge in storage first.
    if (isWidgetLayoutDirty.value && !await persistExtensionWidgets())
      return
    widgetPreferences.value = readExtensionWidgets()
    const pageKey = readyPageLayoutKey.value
    if (pageKey)
      loadExtensionWidgetLayout(widgetPreferences.value.pageLayouts[pageKey]?.contentLayout ?? emptyPageLayout().contentLayout, pageKey)
  }
  if (keys.includes('panelStorage')) {
    const localPanelState = getLocalPanelState()
    panelState.$patch({
      leftSiderCollapsed: localPanelState.leftSiderCollapsed,
      rightSiderCollapsed: localPanelState.rightSiderCollapsed,
      networkMode: localPanelState.networkMode,
    })
  }
  if (keys.some(key => key.startsWith(BOOTSTRAP_SNAPSHOT_KEY_PREFIX)))
    await loadCachedSnapshot()
  refreshPendingMutationsCount()
}

function handleExternalStorageChange(change: StorageChangeEvent) {
  // A server switch changes the scope of every cached key;
  // a clean reload is safer than mixing two scopes in one running tab.
  if (change.scope === 'runtime') {
    window.location.reload()
    return
  }

  if (change.key === 'AUTH_TOKEN') {
    const currentToken = authStore.token
    const currentAccountId = authStore.userInfo?.id
    const newStorage = getAuthStorage() as Partial<AuthState> | null
    const newToken = newStorage?.token ?? null
    const newAccountId = newStorage?.userInfo?.id

    // Only reload when login status actually changes (login, logout, or account switch).
    const isLoginStatusChanged = Boolean(currentToken) !== Boolean(newToken)
      || (Boolean(currentAccountId && newAccountId) && currentAccountId !== newAccountId)

    if (isLoginStatusChanged) {
      window.location.reload()
      return
    }

    // Same account: sync in-memory session (e.g. token refreshed by another tab) without destroying running tab
    if (newStorage && newToken && (newToken !== currentToken || newStorage.refreshToken !== authStore.refreshToken)) {
      authStore.$patch({
        token: newToken,
        refreshToken: newStorage.refreshToken ?? authStore.refreshToken,
        accessExpiresAt: newStorage.accessExpiresAt ?? authStore.accessExpiresAt,
        refreshExpiresAt: newStorage.refreshExpiresAt ?? authStore.refreshExpiresAt,
      })
    }
    return
  }

  if (change.key === 'userStorage') {
    const localUser = getLocalUserState()
    if (localUser?.userInfo && JSON.stringify(userStore.userInfo) !== JSON.stringify(localUser.userInfo))
      userStore.userInfo = { ...userStore.userInfo, ...localUser.userInfo }
    return
  }

  const isLiveDataKey = change.key === EXTENSION_APPEARANCE_KEY
    || change.key === EXTENSION_WIDGETS_KEY
    || change.key === 'panelStorage'
    || change.key.startsWith(BOOTSTRAP_SNAPSHOT_KEY_PREFIX)
    || change.key.startsWith(OFFLINE_QUEUE_KEY_PREFIX)
  if (!isLiveDataKey)
    return

  externalStorageKeys.add(change.key)
  if (externalStorageTimer)
    window.clearTimeout(externalStorageTimer)
  externalStorageTimer = window.setTimeout(applyExternalStorageChanges, 80)
}

// 8. 周期与初始化
onMounted(async () => {
  isDisposed = false
  syncClockTimer()

  removeSyncConflictListener = onSyncConflict(() => {
    void triggerOfflineReplay().then(refreshBootstrap, refreshBootstrap)
  })
  removeStorageListener = runtime.storage.subscribe?.(handleExternalStorageChange) ?? null
  removeOfflineQueueListener = onOfflineQueueChanged(refreshPendingMutationsCount)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('online', handleBrowserOnline)
  window.addEventListener('offline', handleBrowserOffline)
  window.addEventListener('pagehide', flushPendingLayoutIfDirty)
  window.addEventListener('beforeunload', flushPendingLayoutIfDirty)

  void processPendingWidgetCleanups()
  if (authStore.token) await loadCachedSnapshot()
  // Give the restored dashboard a paint opportunity before cloud work.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  await refreshBootstrap()
  if (isDisposed) return
  await triggerOfflineReplay()
  void startSyncWatch()
})

onUnmounted(() => {
  isDisposed = true
  syncWatchController?.abort()
  flushPendingLayoutIfDirty()
  stopClockTimer()
  if (sideHideTimer) clearTimeout(sideHideTimer)
  if (wheelHintTimer) clearTimeout(wheelHintTimer)
  if (wheelLockTimer) clearTimeout(wheelLockTimer)
  if (suppressCardClickTimer) clearTimeout(suppressCardClickTimer)
  if (externalStorageTimer) clearTimeout(externalStorageTimer)
  removeSyncConflictListener?.()
  removeStorageListener?.()
  removeOfflineQueueListener?.()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('online', handleBrowserOnline)
  window.removeEventListener('offline', handleBrowserOffline)
  window.removeEventListener('pagehide', flushPendingLayoutIfDirty)
  window.removeEventListener('beforeunload', flushPendingLayoutIfDirty)
})
</script>

<template>
  <div
    class="extension-tab-container select-none"
    :class="{
      'sidebar-right': sidebarPosition === 'right',
      'sidebar-auto-hide': sidebarAutoHide,
      'sidebar-compact': sidebarDensity === 'compact',
      'sidebar-suppressed': sideRailSuppressed,
      'has-wallpaper': Boolean(activeWallpaper),
    }"
  >
    <!-- 用户自定义壁纸层 -->
    <div
      v-if="activeWallpaper"
      class="bg-cover"
      :style="{
        filter: `blur(${panelState.panelConfig.backgroundBlur ?? 0}px)`,
        backgroundImage: `url(${JSON.stringify(activeWallpaper)})`,
      }"
    />

    <!-- 侧边热区：自动隐藏时，靠近用户指定的屏幕边缘重新显示。 -->
    <button
      v-if="sidebarAutoHide && !sideRailSuppressed"
      type="button"
      class="edge-trigger"
      :aria-label="sidebarPosition === 'left' ? '展开左侧功能区' : '展开右侧功能区'"
      @mouseenter="revealSideArea"
      @mouseleave="scheduleSideAreaHide"
      @focus="revealSideArea"
      @click="revealSideArea"
    />
    <div
      ref="sideRailElement"
      class="side-rail"
      :class="{ revealed: sideRailVisible }"
      :inert="!sideRailVisible"
      @mouseenter="revealSideArea"
      @mouseleave="scheduleSideAreaHide"
      @focusin="revealSideArea"
      @focusout="scheduleSideAreaHide"
    >
      <button type="button" class="rail-avatar" :title="authStore.token ? `${extensionProfileName} · 打开我的设置` : '点击头像登录'" @click="handleAvatarClick">
        <span class="rail-avatar-frame">
          <ProfileAvatar round :size="42" :src="extensionAvatarUrl" />
          <span
            class="rail-avatar-status"
            :class="`is-${extensionSyncPresentation.tone}`"
            :title="extensionSyncPresentation.label"
          />
        </span>
        <span class="rail-avatar-label">{{ authStore.token ? extensionProfileName : '登录' }}</span>
      </button>
      <div class="rail-divider" />
      <div class="rail-groups" aria-label="书签分组">
        <button
          v-for="group in groupTabs"
          :key="group.id"
          type="button"
          class="rail-group-button"
          :class="{ active: activeTabId === group.id }"
          :aria-current="activeTabId === group.id ? 'page' : undefined"
          :title="`${group.title}（${group.count} 项）`"
          @click="selectGroup(group.id)"
        >
          <span class="rail-group-icon" aria-hidden="true">
            <GroupIcon v-if="group.icon && !['material-symbols:folder-outline', 'material-symbols-folder-outline'].includes(group.icon)" :icon="group.icon" :size="28" :title="group.title" />
            <ThemeIcon v-else name="folder" class="rail-icon" />
          </span>
          <span class="rail-group-label">{{ group.title }}</span>
        </button>
        <button type="button" class="rail-group-button rail-group-add" title="新增或管理分组" @click="openGroupManager">
          <ThemeIcon name="add" class="rail-icon" />
          <span class="rail-group-label">新增</span>
        </button>
      </div>
      <div class="rail-spacer" />
      <button type="button" class="rail-button rail-settings" title="打开我的设置" @click="openSettings">
        <ThemeIcon name="settings" class="rail-icon" />
        <span>设置</span>
      </button>
    </div>
    <div
      v-if="activeWallpaper"
      class="bg-overlay"
      :style="{ backgroundColor: `rgba(0,0,0,${panelState.panelConfig.backgroundMaskNumber ?? 0.35})` }"
    />

    <!-- 核心主体区 -->
    <main class="main-content flex flex-col items-center justify-start overflow-y-auto px-4 pb-12 pt-6" @wheel="handleGroupWheel">
      <header class="workspace-heading">
        <button type="button" class="workspace-brand" title="打开设置" aria-label="打开设置" @click="openSettings">
          <span class="workspace-brand-mark" aria-hidden="true"><ThemeIcon name="dashboard" /></span><span>Panel <b>Next</b></span>
        </button>
        <div
          v-if="['cached', 'offline', 'error'].includes(extensionSyncStatus) || pendingMutationsCount > 0"
          class="sync-status-banner"
          :class="`is-${extensionSyncPresentation.tone}`"
          role="status"
        >
          <SvgIcon icon="material-symbols:sync" />
          <span>{{ extensionSyncPresentation.label }}</span>
          <small v-if="pendingMutationsCount">{{ pendingMutationsCount }} 项修改等待同步</small>
          <button v-if="authStore.token" type="button" @click="queueManagerVisible = true">
            查看
          </button>
        </div>
      </header>

      <!-- 极简大数字时钟与日期 -->
      <section v-if="widgetPreferences.clock" class="clock-hero flex flex-col items-center mb-6 text-shadow-md">
        <p class="clock-eyebrow">
          留一点空间，给重要的事
        </p>
        <div class="time-display flex items-baseline font-mono font-bold tracking-tight">
          <span class="text-6xl md:text-8xl select-all font-light">{{ currentTime }}</span>
          <span v-if="widgetPreferences.clockSeconds" class="clock-seconds text-xl md:text-2xl opacity-70 ml-2 font-normal">{{ currentSeconds }}</span>
          <span v-if="currentPeriod" class="clock-period">{{ currentPeriod }}</span>
        </div>
        <div v-if="widgetPreferences.clockDate" class="date-display text-sm md:text-base font-normal tracking-wide opacity-90 mt-1">
          {{ currentDate }}
        </div>
      </section>

      <!-- 主搜索栏只负责联网搜索与网址直达；书签搜索使用独立面板。 -->
      <section v-if="widgetPreferences.search" class="search-section w-full max-w-[600px] mb-8" @focusin="isSearchFocused = true" @focusout="handleSearchFocusOut">
        <div
          class="search-bar-capsule flex items-center backdrop-blur-xl px-3 py-2 shadow-lg transition-all duration-300"
          :class="{ 'is-focused': isSearchFocused }"
        >
          <!-- 搜索引擎下拉切换 -->
          <NDropdown :options="engineDropdownOptions" trigger="click" @select="handleSelectEngine">
            <button
              type="button"
              class="engine-select-btn flex items-center space-x-1 pl-2 pr-2 py-1 rounded-full hover:bg-white/20 dark:hover:bg-white/10 transition-colors"
              :aria-label="`当前搜索引擎：${currentEngine.title}，点击切换`"
            >
              <img v-if="currentEngine.iconSrc" :src="currentEngine.iconSrc" class="w-4 h-4 object-contain" :alt="currentEngine.title">
              <SvgIcon v-else :icon="currentEngine.icon" class="w-4 h-4 text-white" />
              <SvgIcon icon="mingcute:down-small-fill" class="w-3 h-3 text-white/70" />
            </button>
          </NDropdown>

          <!-- 搜索输入框 -->
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            autocomplete="off"
            :maxlength="200"
            aria-controls="extension-search-history"
            :aria-expanded="widgetPreferences.searchHistoryEnabled && isSearchFocused && !searchHistoryDismissed && widgetPreferences.searchHistory.length > 0"
            placeholder="搜索网页或输入网址"
            aria-label="搜索网页或输入网址"
            class="extension-search-input flex-1 bg-transparent border-none outline-none px-3 text-sm md:text-base"
            @focus="isSearchFocused = true; searchHistoryDismissed = false"
            @click="searchHistoryDismissed = false"
            @input="searchHistoryDismissed = false"
            @keydown.enter="!$event.isComposing && handleSearchSubmit()"
            @keydown.down.prevent="searchHistoryPanelRef?.focusEntry()"
            @keydown.up.prevent="searchHistoryPanelRef?.focusEntry(true)"
            @keydown.esc.prevent="dismissSearchHistory"
          >

          <!-- 清除按钮 -->
          <button
            v-if="searchQuery"
            type="button"
            class="clear-btn text-white/70 hover:text-white mr-1 p-1 rounded-full hover:bg-white/20 transition-colors"
            aria-label="清空搜索内容"
            @click="searchQuery = ''; searchHistoryDismissed = false; searchInputRef?.focus()"
          >
            <SvgIcon icon="material-symbols:close-rounded" class="w-4 h-4" />
          </button>

          <button
            type="button"
            class="bookmark-search-trigger"
            :class="{ active: bookmarkSearchOpen }"
            title="搜索书签"
            aria-label="搜索书签"
            :aria-expanded="bookmarkSearchOpen"
            @click="toggleBookmarkSearch"
          >
            <SvgIcon icon="material-symbols:folder-outline" class="w-4 h-4" />
          </button>

          <!-- 回车搜索图标按钮 -->
          <button
            type="button"
            class="search-submit-btn p-2 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-md transition-transform active:scale-95"
            title="搜索"
            @click="handleSearchSubmit"
          >
            <SvgIcon icon="material-symbols:search-rounded" class="w-4 h-4" />
          </button>
        </div>

        <SearchHistoryPanel
          id="extension-search-history"
          ref="searchHistoryPanelRef"
          :entries="widgetPreferences.searchHistory"
          :query="searchQuery"
          :visible="widgetPreferences.searchHistoryEnabled && isSearchFocused && !searchHistoryDismissed && !bookmarkSearchOpen"
          @select="selectSearchHistory"
          @remove="widgetPreferences.searchHistory = widgetPreferences.searchHistory.filter(item => item !== $event)"
          @clear="clearSearchHistory"
          @close="dismissSearchHistory"
        />
        <Transition name="bookmark-search-panel">
          <section v-if="bookmarkSearchOpen" class="bookmark-search-panel" aria-label="搜索书签">
            <header class="bookmark-search-header">
              <div>
                <b>搜索书签</b>
                <small>跨全部分组查找，不影响主页图标</small>
              </div>
              <button type="button" aria-label="关闭书签搜索" @click="closeBookmarkSearch">
                <SvgIcon icon="material-symbols:close-rounded" />
              </button>
            </header>
            <div class="bookmark-search-input-wrap">
              <SvgIcon icon="material-symbols:search-rounded" />
              <input
                ref="bookmarkSearchInputRef"
                v-model="bookmarkSearchQuery"
                type="search"
                placeholder="输入书签名称、描述或网址"
                @keydown.esc="closeBookmarkSearch"
              >
            </div>
            <div v-if="bookmarkSearchResults.length" class="bookmark-search-results">
              <button
                v-for="result in bookmarkSearchResults"
                :key="result.key"
                type="button"
                @click="openBookmarkSearchResult(result.card)"
              >
                <span class="bookmark-result-icon">
                  <ItemIcon :item-icon="result.card.icon" :size="28" :fallback-text="result.card.title" :site-url="result.card.url" />
                </span>
                <span class="bookmark-result-copy">
                  <b>{{ result.card.title }}</b>
                  <small>{{ result.groupTitle }} · {{ result.card.description || result.card.url }}</small>
                </span>
                <SvgIcon icon="mdi:open-in-new" class="bookmark-result-open" />
              </button>
            </div>
            <div v-else class="bookmark-search-empty">
              {{ bookmarkSearchQuery.trim() ? '没有找到匹配的书签' : '输入关键词开始查找' }}
            </div>
          </section>
        </Transition>
      </section>

      <section class="dashboard-canvas-section w-full max-w-[1120px]">
        <Transition :name="`group-slide-${groupSlideDirection}`" mode="out-in">
          <div :key="activeTabId ?? 'empty'" class="dashboard-group-page">
            <div class="dashboard-canvas-header">
              <div class="active-group-meta">
                <span>{{ activeGroup?.title }}</span>
                <small>{{ activeGroup?.count || 0 }} 个书签 · {{ buildWidgetDisplayGroups(extensionWidgetInstances).length }} 个组件</small>
              </div>
              <div v-if="extensionWidgetEditMode" class="extension-widget-toolbar">
                <div class="extension-edit-mode-copy">
                  <strong>正在编辑当前页面</strong>
                  <small>拖动调整位置，拖拽边缘改变大小</small>
                </div>
                <button type="button" class="modal-secondary-action flex items-center gap-1" :title="t('widgetLayout.done')" :aria-label="t('widgetLayout.done')" @click="extensionWidgetEditMode = false">
                  <SvgIcon icon="material-symbols:check-rounded" class="w-4 h-4" />
                  <span>{{ t('widgetLayout.done') }}</span>
                </button>
              </div>
            </div>

            <div ref="extensionWidgetGridRef" class="extension-dashboard-grid" :class="{ 'is-editing': extensionWidgetEditMode }">
              <VueDraggable
                v-if="activeCanvasItems.length"
                v-model="activeCanvasItems"
                item-key="key"
                class="extension-dashboard-track"
                :disabled="!groupsReady || Boolean(resizingExtensionWidgetId) || activeCanvasItems.length < 2"
                :delay="extensionWidgetEditMode ? 0 : 480"
                :delay-on-touch-only="false"
                :touch-start-threshold="8"
                :fallback-tolerance="8"
                filter="input, textarea, button, a, select, [contenteditable='true'], [data-no-drag], .widget-resize-handle"
                :prevent-on-filter="false"
                chosen-class="is-dashboard-dragging"
                :animation="180"
                @start="handleBookmarkDragStart"
                @end="handleBookmarkDragEnd"
              >
                <div
                  v-for="item in activeCanvasItems"
                  :key="item.key"
                  class="dashboard-canvas-item"
                  :class="item.kind === 'widget' ? ['extension-widget-cell', { 'is-widget-hidden': item.group.members[0].hidden, 'is-resizing': resizingExtensionWidgetId === item.group.members[0].id }] : ['speed-card', { 'is-expanded': bookmarkLayout(item.card).columns > 1 || bookmarkLayout(item.card).rows > 1 }]"
                  :style="item.kind === 'widget' ? extensionWidgetCellStyle(item.group) : bookmarkCardStyle(item.card)"
                  :title="item.kind === 'bookmark' ? item.card.description || item.card.title : undefined"
                  :aria-label="item.kind === 'bookmark' ? item.card.title : `${widgetDefinitionTitle(widgetRegistry.get(item.group.members[0].type) ?? { type: item.group.members[0].type })} 小组件`"
                  :role="item.kind === 'bookmark' ? 'link' : undefined"
                  tabindex="0"
                  @click="item.kind === 'bookmark' && handleCardClick(item.card)"
                  @contextmenu="item.kind === 'bookmark' ? handleCardContextMenu($event, item.card) : handleWidgetContextMenu($event, item.group.members[0])"
                  @keydown.enter.prevent="item.kind === 'bookmark' && handleCardClick(item.card)"
                  @keydown.space.prevent="item.kind === 'bookmark' && handleCardClick(item.card)"
                  @keydown="item.kind === 'bookmark' ? openCardContextMenuFromKeyboard($event, item.card) : openWidgetContextMenuFromKeyboard($event, item.group.members[0])"
                >
                  <template v-if="item.kind === 'bookmark'">
                    <button v-if="authStore.visitMode === VisitMode.VISIT_MODE_LOGIN" type="button" class="speed-card-edit" data-no-drag :title="t('common.edit')" :aria-label="t('common.edit')" @click.stop="openCardEditor(item.card)">
                      <SvgIcon icon="material-symbols:edit-outline-rounded" class="w-3.5 h-3.5" />
                    </button>
                    <div class="card-icon-box">
                      <ItemIcon :item-icon="item.card.icon" :size="64" :fallback-text="item.card.title" :site-url="item.card.url" class="card-item-icon" />
                    </div>
                    <div class="card-info">
                      <span class="card-title">{{ item.card.title }}</span>
                      <small v-if="bookmarkLayout(item.card).columns > 1 || bookmarkLayout(item.card).rows > 1" class="card-description">{{ item.card.description || item.card.url }}</small>
                    </div>
                  </template>

                  <template v-else>
                    <div v-if="extensionWidgetEditMode" class="extension-widget-editor" :class="{ 'is-compact': item.group.size.columns <= 2 }">
                      <span class="extension-widget-handle" :title="t('widgetLayout.drag')" :aria-label="t('widgetLayout.drag')">
                        <SvgIcon icon="material-symbols:drag-indicator" class="w-4 h-4" />
                      </span>
                      <span v-if="item.group.stackId" class="extension-widget-stack-badge">{{ `${t('widgetLayout.stack.title')} ${item.group.members.length}` }}</span>
                      <span class="extension-widget-name">{{ widgetDefinitionTitle(widgetRegistry.get(item.group.members[0].type) ?? { type: item.group.members[0].type }) }}</span>
                      <span class="extension-widget-size">{{ item.group.size.columns }}×{{ item.group.size.rows }}</span>
                      <span class="extension-widget-actions">
                        <button v-if="hasExtensionWidgetSettings(item.group.members[0])" type="button" class="is-labelled" :title="t('widgetLayout.configure')" :aria-label="t('widgetLayout.configure')" @click="openExtensionWidgetSettings(item.group.members[0])">配置</button>
                        <NDropdown v-if="!item.group.stackId && extensionWidgetStackTargetOptions(item.group.members[0]).length" trigger="click" :options="extensionWidgetStackTargetOptions(item.group.members[0])" @select="stackExtensionWidgetWith(item.group.members[0], $event)">
                          <button type="button" class="is-labelled" :title="t('widgetLayout.stack.add')" :aria-label="t('widgetLayout.stack.add')">叠放</button>
                        </NDropdown>
                        <button type="button" title="更多组件操作" aria-label="更多组件操作" @click.stop="handleWidgetContextMenu($event, item.group.members[0])"><SvgIcon icon="mingcute:more-1-fill" /></button>
                      </span>
                    </div>
                    <WidgetStackHost :instances="item.group.members" />
                    <span class="dashboard-widget-caption">{{ widgetDefinitionTitle(widgetRegistry.get(item.group.members[0].type) ?? { type: item.group.members[0].type }) }}</span>
                    <template v-if="extensionWidgetEditMode && !item.group.stackId && !item.group.members[0].hidden">
                      <button type="button" class="widget-resize-handle is-right" data-no-drag :aria-label="t('widgetLayout.widen')" @pointerdown="startExtensionWidgetResize($event, item.group.members[0], 'columns', extensionWidgetGridRef)" />
                      <button type="button" class="widget-resize-handle is-bottom" data-no-drag :aria-label="t('widgetLayout.stretch')" @pointerdown="startExtensionWidgetResize($event, item.group.members[0], 'rows', extensionWidgetGridRef)" />
                      <button type="button" class="widget-resize-handle is-corner" data-no-drag :aria-label="`${t('widgetLayout.widen')} / ${t('widgetLayout.stretch')}`" @pointerdown="startExtensionWidgetResize($event, item.group.members[0], 'both', extensionWidgetGridRef)" />
                    </template>
                  </template>
                </div>
              </VueDraggable>

              <div v-else class="extension-widget-empty">
                <SvgIcon icon="material-symbols:dashboard-customize-outline-rounded" class="w-10 h-10 opacity-60" />
                <p>当前页面还是空的</p>
                <small>点击添加图标，选择网站或小组件开始布置</small>
              </div>

              <button v-if="activeGroup" type="button" class="dashboard-add-icon" :title="t('iconGallery.title')" :aria-label="t('iconGallery.title')" @click="openAddCenter()">
                <span class="dashboard-add-icon-symbol"><SvgIcon icon="material-symbols-add-rounded" /></span>
                <span>{{ t('iconGallery.title') }}</span>
              </button>
            </div>
          </div>
        </Transition>
      </section>
      <footer class="workspace-footer">
        <span>属于你的每一次开始</span>
      </footer>
    </main>

    <Transition name="wheel-hint">
      <div v-if="wheelHintVisible" class="wheel-switch-hint">
        <SvgIcon icon="material-symbols:mouse-outline-rounded" />
        <span>{{ activeGroup?.title }}</span>
        <small>{{ activeGroup?.count || 0 }} 项</small>
      </div>
    </Transition>

    <div v-if="rightMenuShow || widgetRightMenuShow" class="context-menu-dismiss" @pointerdown="closeContextMenus()" @contextmenu.prevent="closeContextMenus()" />

    <!-- 书签右键：布局只写 Extension 偏好，不修改云端书签内容。 -->
    <div
      v-if="rightMenuShow && activeRightCard"
      ref="bookmarkContextMenuRef"
      class="extension-context-menu"
      :style="{ left: `${rightMenuX}px`, top: `${rightMenuY}px` }"
      role="menu"
      @pointerdown.stop
      @keydown="handleContextMenuKeydown"
    >
      <button type="button" class="context-menu-row" role="menuitem" @click="handleRightMenuSelect('open_tab')">
        <ThemeIcon name="externalLink" /><span>在新标签页打开</span>
      </button>
      <button v-if="activeRightCard.lanUrl" type="button" class="context-menu-row" role="menuitem" @click="handleRightMenuSelect('open_lan')">
        <ThemeIcon name="networkWired" /><span>打开局域网地址</span>
      </button>
      <div class="context-menu-section">
        <div class="context-menu-title">
          <ThemeIcon name="dashboard" /><span>布局</span>
        </div>
        <div class="context-size-grid">
          <button
            v-for="layout in bookmarkLayoutChoices"
            :key="`${layout.columns}x${layout.rows}`"
            type="button"
            :class="{ active: bookmarkLayout(activeRightCard).columns === layout.columns && bookmarkLayout(activeRightCard).rows === layout.rows }"
            @click="setBookmarkLayout(activeRightCard, layout); closeContextMenus()"
          >
            {{ layout.columns }}×{{ layout.rows }}
          </button>
        </div>
      </div>
      <template v-if="authStore.visitMode === VisitMode.VISIT_MODE_LOGIN">
        <div class="context-menu-divider" />
        <button type="button" class="context-menu-row" role="menuitem" @click="handleRightMenuSelect('edit')">
          <ThemeIcon name="edit" /><span>编辑书签</span>
        </button>
        <button type="button" class="context-menu-row" role="menuitem" @click="handleRightMenuSelect('edit_home')">
          <ThemeIcon name="folder" /><span>编辑分组</span>
        </button>
        <button type="button" class="context-menu-row danger" role="menuitem" @click="handleRightMenuSelect('delete')">
          <ThemeIcon name="delete" /><span>删除</span>
        </button>
      </template>
    </div>

    <!-- 小组件右键：尺寸由注册表解析后生成，不允许越过组件 min/max/supportedSizes。 -->
    <div
      v-if="widgetRightMenuShow && activeRightWidget"
      ref="widgetContextMenuRef"
      class="extension-context-menu widget-context-menu"
      :style="{ left: `${rightMenuX}px`, top: `${rightMenuY}px` }"
      role="menu"
      @pointerdown.stop
      @keydown="handleContextMenuKeydown"
    >
      <div class="context-menu-heading">
        <span>{{ widgetDefinitionTitle(widgetRegistry.get(activeRightWidget.type) ?? { type: activeRightWidget.type }) }}</span>
        <small>{{ activeRightWidget.size.columns }}×{{ activeRightWidget.size.rows }}</small>
      </div>
      <div v-if="activeWidgetSizeChoices.length" class="context-menu-section">
        <div class="context-menu-title">
          <ThemeIcon name="dashboard" /><span>布局</span>
        </div>
        <div class="context-size-grid">
          <button
            v-for="size in activeWidgetSizeChoices"
            :key="`${size.columns}x${size.rows}`"
            type="button"
            :class="{ active: activeRightWidget.size.columns === size.columns && activeRightWidget.size.rows === size.rows }"
            @click="setActiveWidgetSize(size); closeContextMenus()"
          >
            {{ size.columns }}×{{ size.rows }}
          </button>
        </div>
      </div>
      <p v-else-if="activeRightWidget.stack" class="context-menu-note">
        叠放中的组件需先移出叠放，再单独调整尺寸。
      </p>
      <div class="context-menu-divider" />
      <button v-if="hasExtensionWidgetSettings(activeRightWidget)" type="button" class="context-menu-row" role="menuitem" @click="openActiveWidgetSettings">
        <ThemeIcon name="settings" /><span>配置组件</span>
      </button>
      <button type="button" class="context-menu-row" role="menuitem" @click="toggleExtensionWidgetHidden(activeRightWidget); closeContextMenus()">
        <ThemeIcon :name="activeRightWidget.hidden ? 'eye' : 'eyeOff'" /><span>{{ activeRightWidget.hidden ? '显示组件' : '隐藏组件' }}</span>
      </button>
      <button v-if="activeRightWidget.stack" type="button" class="context-menu-row" role="menuitem" @click="removeExtensionWidgetFromStack(activeRightWidget); closeContextMenus()">
        <ThemeIcon name="drag" /><span>移出叠放</span>
      </button>
      <button type="button" class="context-menu-row" role="menuitem" @click="showWidgetManager = true; closeContextMenus()">
        <ThemeIcon name="dashboard" /><span>编辑主页组件</span>
      </button>
      <button type="button" class="context-menu-row" role="menuitem" @click="extensionWidgetEditMode = true; closeContextMenus()">
        <ThemeIcon name="drag" /><span>自由排版</span>
      </button>
      <button type="button" class="context-menu-row danger" role="menuitem" @click="removeActiveWidgetFromMenu">
        <ThemeIcon name="delete" /><span>删除</span>
      </button>
    </div>

    <!-- 现代化专属个人中心与系统控制台 -->
    <UserHubModal
      v-model:show="settingsModalVisible"
      v-model:clock-enabled="extensionClockEnabled"
      v-model:clock-seconds="extensionClockSeconds"
      v-model:clock-date="extensionClockDate"
      v-model:clock-hour-cycle="extensionClockHourCycle"
      v-model:search-enabled="extensionSearchEnabled"
      v-model:search-engine-id="widgetPreferences.searchEngineId"
      v-model:search-open-mode="extensionSearchOpenMode"
      v-model:search-history-enabled="extensionSearchHistoryEnabled"
      v-model:sidebar-position="sidebarPosition"
      v-model:sidebar-auto-hide="sidebarAutoHide"
      v-model:sidebar-wheel-switch="sidebarWheelSwitch"
      v-model:sidebar-density="sidebarDensity"
      :groups="groups"
      :search-history-count="widgetPreferences.searchHistory.length"
      :sync-status="extensionSyncStatus"
      :sync-revision="syncRevision"
      @group-icon-saved="handleGroupIconSaved"
      @group-order-saved="handleGroupOrderSaved"
      @refresh="refreshBootstrap"
      @open-wallpaper="settingsModalVisible = false; showWallpaperModal = true"
      @open-widget-manager="settingsModalVisible = false; showWidgetManager = true"
      @open-sync-queue="settingsModalVisible = false; queueManagerVisible = true"
      @clear-search-history="clearSearchHistory"
    />

    <NModal
      v-model:show="showGroupManager"
      preset="card"
      title="分组管理"
      class="group-manager-modal extension-surface-modal"
      style="width: min(680px, calc(100vw - 24px)); height: min(640px, calc(100vh - 24px)); border-radius: 20px;"
      @after-leave="closeGroupManager"
    >
      <ItemGroupManage />
    </NModal>

    <!-- 编辑卡片弹窗 -->
    <EditItem
      v-if="editCardModalVisible"
      v-model:visible="editCardModalVisible"
      :item-info="editCardData"
      :item-group-id="editCardGroupId"
      @done="handleEditSuccess"
    />

    <NModal
      v-model:show="showWidgetManager"
      preset="card"
      :title="t('widgetLayout.manager.title')"
      class="widget-manager-modal extension-surface-modal"
      style="width: min(520px, calc(100vw - 24px)); border-radius: 20px;"
    >
      <div class="widget-manager-content">
        <p>{{ t('widgetLayout.manager.desc') }}</p>
        <div class="widget-manager-page-scope">
          <SvgIcon icon="material-symbols:folder-outline" />
          <span><b>{{ activeGroup?.title }}</b><small>这里只管理当前分组页面的组件，切换分组后可单独配置。</small></span>
        </div>
        <label class="widget-choice">
          <span><SvgIcon icon="material-symbols:schedule-outline-rounded" /><b>{{ t('widgetLayout.manager.clockTitle') }}</b><small>{{ t('widgetLayout.manager.clockDesc') }}</small></span>
          <NSwitch v-model:value="widgetPreferences.clock" />
        </label>
        <label class="widget-choice">
          <span><SvgIcon icon="material-symbols:search-rounded" /><b>{{ t('widgetLayout.manager.searchTitle') }}</b><small>{{ t('widgetLayout.manager.searchDesc') }}</small></span>
          <NSwitch v-model:value="widgetPreferences.search" />
        </label>
        <div class="extension-widget-library">
          <div class="extension-widget-library-head">
            <div><b>{{ t('widgetLayout.manager.contentWidgetsTitle') }}</b><small>{{ t('widgetLayout.manager.contentWidgetsDesc') }}</small></div>
            <button type="button" class="modal-secondary-action" @click="showWidgetManager = false; openAddCenter('widgets')">
              {{ t('widgetLayout.add') }}
            </button>
          </div>
          <div v-if="extensionWidgetInstances.length" class="extension-widget-list">
            <div v-for="(instance, index) in extensionWidgetInstances" :key="instance.id" class="extension-widget-list-item">
              <span>{{ widgetDefinitionTitle(widgetRegistry.get(instance.type) ?? { type: instance.type }) }}</span>
              <div>
                <button v-if="Object.keys(widgetRegistry.get(instance.type)?.configSchema.fields ?? {}).length" type="button" @click="openExtensionWidgetSettings(instance)">
                  {{ t('widgetLayout.configure') }}
                </button>
                <button type="button" @click="confirmRemoveExtensionWidget(index)">
                  {{ t('widgetLayout.remove') }}
                </button>
              </div>
            </div>
          </div>
          <small v-else>{{ t('widgetLayout.empty') }}</small>
        </div>
        <button type="button" class="modal-primary-action" @click="showWidgetManager = false">
          {{ t('widgetLayout.done') }}
        </button>
      </div>
    </NModal>

    <IconGalleryModal v-model:show="showIconGallery" :page-id="activeTabId" :pages="groupTabs" :initial-section="addCenterSection" :can-add="authStore.visitMode === VisitMode.VISIT_MODE_LOGIN && Boolean(authStore.token)" :added-counts="extensionWidgetAddedCounts" :busy="addingExtensionWidget" @update:page-id="selectGroup" @add-widget="addExtensionWidget" @done="handleEditSuccess" @login="goToIconLogin" />

    <WidgetSettingsModal v-model:show="extensionWidgetSettingsVisible" :instance="extensionWidgetSettingsInstance" @save="applyExtensionWidgetSettings" />

    <!-- 壁纸库 / Wallhaven 选择弹窗 -->
    <NModal
      v-model:show="showWallpaperModal"
      preset="card"
      title="高清壁纸库 (Wallhaven 4K / 图库)"
      class="wallpaper-manager-modal extension-surface-modal"
      style="width: min(960px, calc(100vw - 24px)); height: min(680px, calc(100vh - 24px)); border-radius: 20px;"
      size="small"
      role="dialog"
      aria-modal="true"
    >
      <GallerySelector type="wallpaper" @select="handleWallpaperSelect" />
    </NModal>

    <!-- 离线冲突裁决弹窗 -->
    <ConflictResolverModal
      v-model:show="conflictModalVisible"
      :conflict="currentConflict"
      @resolve="onResolveConflict"
    />

    <!-- 离线队列管理 -->
    <OfflineQueueManager
      v-model:show="queueManagerVisible"
      :account-id="authStore.userInfo?.id"
      @replay="triggerOfflineReplay()"
      @changed="refreshPendingMutationsCount"
    />
  </div>
</template>

<style scoped>
.extension-tab-container {
  position: relative;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: #f8fafc;
  font-family: var(--pn-font-family);
  background-color: var(--pn-color-page-background);
  background-size: cover;
  background-attachment: fixed;
}

/* 背景层 */
.bg-cover {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.bg-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.edge-trigger {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 42;
  width: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.side-rail {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 40;
  width: 68px;
  padding: 18px 7px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  background: rgba(8, 13, 24, 0.56);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(22px) saturate(135%);
  box-shadow: 8px 0 30px rgba(0, 0, 0, 0.12);
  transition: transform 240ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease;
}

.sidebar-auto-hide .side-rail:not(.revealed) {
  opacity: 0;
  pointer-events: none;
  transform: translateX(calc(-100% - 8px));
}

.sidebar-right .edge-trigger { inset: 0 0 0 auto; }
.sidebar-right .side-rail {
  inset: 0 0 0 auto;
  border-right: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: -8px 0 30px rgba(0, 0, 0, 0.12);
}
.sidebar-right.sidebar-auto-hide .side-rail:not(.revealed) { transform: translateX(calc(100% + 8px)); }

.rail-avatar,
.rail-button,
.rail-group-button {
  display: grid;
  place-items: center;
  border: 0;
  color: rgba(255, 255, 255, 0.68);
  cursor: pointer;
}

.rail-avatar {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-radius: 10px;
  background: transparent;
}
.rail-avatar-label { width: 52px; overflow: hidden; color: rgba(255,255,255,.76); font-size: 9px; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; text-align: center; }

.rail-divider {
  width: 34px;
  height: 1px;
  margin: 3px 0 7px;
  background: rgba(255, 255, 255, 0.14);
}

.rail-button {
  position: relative;
  width: 54px;
  min-height: 46px;
  border-radius: 11px;
  background: transparent;
  font-size: 10px;
  transition: 180ms ease;
}

.rail-icon,
.rail-button :deep(svg) {
  display: block;
  width: 20px;
  height: 20px;
  flex: none;
}

.rail-button:hover,
.rail-button.active {
  color: white;
  background: rgba(255, 255, 255, 0.14);
}

.rail-groups {
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow-y: auto;
  scrollbar-width: none;
}
.rail-groups::-webkit-scrollbar { display: none; }
.rail-group-button {
  position: relative;
  width: 100%;
  min-height: 52px;
  padding: 5px 2px;
  gap: 3px;
  color: rgba(255,255,255,.68);
  border-radius: 11px;
  background: transparent;
  transition: color .18s ease, background-color .18s ease;
}
.rail-group-button:hover,
.rail-group-button.active { color: #fff; background: rgba(255,255,255,.13); }
.rail-group-button.active::before {
  content: '';
  position: absolute;
  left: -7px;
  width: 3px;
  height: 26px;
  border-radius: 0 3px 3px 0;
  background: #67e8f9;
}
.sidebar-right .rail-group-button.active::before { right: -7px; left: auto; border-radius: 3px 0 0 3px; }
.rail-group-icon {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 1px solid rgba(255,255,255,.2);
  border-radius: 8px;
  background: rgba(255,255,255,.08);
  font: 700 10px/1 ui-monospace, monospace;
}
.rail-group-button.active .rail-group-icon { color: #a5f3fc; border-color: rgba(103,232,249,.48); background: rgba(34,211,238,.14); }
.rail-group-label { display: block; width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; line-height: 1.2; text-align: center; }
.rail-group-add { color: rgba(165,243,252,.78); }
.rail-spacer { flex: 1; min-height: 8px; }
.rail-settings { display: flex; flex-direction: column; gap: 2px; flex: none; }

/* 核心内容区 */
.main-content {
  position: relative;
  z-index: 5;
  flex: 1;
}

.text-shadow-md {
  text-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

/* 搜索栏 */
.search-bar-capsule {
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
  background: var(--pn-search-background, var(--pn-widget-background, rgb(255 255 255 / 20%)));
  border: 1px solid var(--pn-search-border, var(--pn-widget-border, rgb(255 255 255 / 25%)));
  border-radius: var(--pn-search-radius, var(--pn-radius-large, 999px));
}

/* 聚焦态：读取搜索 Token，避免写死 --pn-widget-* 或任意硬编码颜色。 */
.search-bar-capsule.is-focused {
  box-shadow: 0 0 0 2px var(--pn-color-accent, rgb(52 211 153 / 60%));
  background: var(--pn-search-background, var(--pn-widget-background, rgb(255 255 255 / 30%)));
}

.active-group-meta { margin: 0 10px 12px; display: flex; align-items: baseline; gap: 10px; color: rgba(255,255,255,.9); }
.active-group-meta > span { font-size: 13px; font-weight: 650; }
.active-group-meta small { color: rgba(255,255,255,.48); font-size: 10px; }

.wheel-switch-hint {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 45;
  transform: translateX(-50%);
  padding: 9px 13px;
  display: flex;
  align-items: center;
  gap: 7px;
  color: white;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 999px;
  background: rgba(8,13,24,.72);
  backdrop-filter: blur(18px);
  box-shadow: 0 10px 35px rgba(0,0,0,.28);
  font-size: 11px;
}
.wheel-switch-hint small { color: rgba(255,255,255,.45); }
.wheel-hint-enter-active,.wheel-hint-leave-active { transition: 180ms ease; }
.wheel-hint-enter-from,.wheel-hint-leave-to { opacity: 0; transform: translate(-50%, 8px); }

.context-menu-dismiss { position: fixed; inset: 0; z-index: 46; background: transparent; }
.extension-context-menu {
  position: fixed;
  z-index: 47;
  width: 252px;
  max-height: calc(100vh - 20px);
  padding: 9px;
  overflow-y: auto;
  color: #f8fafc;
  border: 1px solid rgba(148,163,184,.2);
  border-radius: 15px;
  background: linear-gradient(145deg, rgba(16,24,40,.96), rgba(8,47,58,.92));
  box-shadow: 0 18px 48px rgba(2,6,23,.48);
  backdrop-filter: blur(24px) saturate(145%);
  user-select: none;
}
.widget-context-menu { width: 280px; background: linear-gradient(145deg, rgba(17,24,39,.97), rgba(30,41,59,.93)); }
.context-menu-row {
  width: 100%;
  min-height: 36px;
  padding: 8px 9px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: rgba(248,250,252,.9);
  border: 0;
  border-radius: 9px;
  background: transparent;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.context-menu-row:hover { color: #fff; background: rgba(255,255,255,.1); }
.context-menu-row.danger { color: #fca5a5; }
.context-menu-row > svg { width: 16px; height: 16px; flex: none; }
.context-menu-section { padding: 7px 9px 6px; }
.context-menu-title { margin-bottom: 7px; display: flex; align-items: center; gap: 7px; color: rgba(248,250,252,.86); font-size: 11px; font-weight: 650; }
.context-menu-title > svg { width: 14px; height: 14px; }
.context-size-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.context-size-grid button { min-width: 40px; padding: 4px 8px; border: 1px solid transparent; border-radius: 999px; color: rgba(248,250,252,.86); background: rgba(255,255,255,.14); font-size: 11px; line-height: 1.2; cursor: pointer; }
.context-size-grid button:hover,.context-size-grid button.active { color: #ecfeff; border-color: rgba(103,232,249,.48); background: rgba(34,211,238,.22); }
.context-menu-divider { height: 1px; margin: 5px 8px; background: rgba(148,163,184,.18); }
.context-menu-heading { padding: 7px 9px 8px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.context-menu-heading span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 720; }
.context-menu-heading small { padding: 3px 7px; border-radius: 999px; color: #a5f3fc; background: rgba(8,145,178,.16); font-size: 10px; }
.context-menu-note { margin: 0; padding: 8px 9px; color: #94a3b8; font-size: 10px; line-height: 1.5; }

/* iOS 主屏式书签网格 */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
  grid-auto-flow: dense;
  grid-auto-rows: 96px;
  gap: 22px 12px;
  padding: 10px 6px 18px;
}

@media (min-width: 768px) {
  .cards-grid {
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 26px 16px;
  }
}

/* 单个图标不再使用半透明大卡片，点击区域仍覆盖图标与名称。 */
.speed-card {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 3px 2px 6px;
  border: 0;
  border-radius: 16px;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
  transition: transform .2s cubic-bezier(.2,.8,.2,1), filter .2s ease;
  text-align: center;
  touch-action: pan-y;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.speed-card.is-expanded { justify-content: center; padding: 12px; border-radius: 20px; background: rgba(15,23,42,.38); backdrop-filter: blur(16px); }
.speed-card.is-expanded .card-icon-box { width: 68px; height: 68px; }
.card-description { width: 100%; margin-top: 4px; display: -webkit-box; overflow: hidden; color: rgba(255,255,255,.6); font-size: 10px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.speed-card-edit {
  position: absolute;
  top: -3px;
  left: 50%;
  z-index: 4;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255,255,255,.5);
  border-radius: 50%;
  color: white;
  background: rgba(15,23,42,.82);
  box-shadow: 0 2px 8px rgba(2,6,23,.36);
  opacity: 0;
  transform: translateX(17px);
  transition: opacity .18s ease, background .18s ease, transform .18s ease;
}
.speed-card:hover .speed-card-edit,
.speed-card-edit:focus-visible {
  opacity: 1;
  transform: translate(17px, -4px);
}

.speed-card:hover {
  transform: none;
}

.speed-card.is-expanded:hover {
  transform: translateY(-2px);
  filter: brightness(1.06);
}

.speed-card:focus-visible {
  outline: 2px solid var(--pn-color-accent, #67e8f9);
  outline-offset: 5px;
}

.speed-card.is-long-pressing {
  transform: scale(.92);
  filter: brightness(1.12);
}

.speed-card.is-long-pressing .card-icon-box {
  box-shadow: 0 0 0 3px rgba(103,232,249,.72), 0 10px 24px rgba(2,6,23,.36);
}

.extension-widget-grid {
  --widget-grid-row-height: 96px;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-flow: dense;
  grid-auto-rows: var(--widget-grid-row-height);
  gap: 14px;
  padding: 8px;
  position: relative;
}
.extension-widget-cell { position: relative; min-width: 0; min-height: 0; touch-action: pan-y; }
.extension-widget-grid.is-editing .extension-widget-cell { outline: 1px dashed rgba(103,232,249,.38); outline-offset: 2px; border-radius: 14px; }
.extension-widget-cell.is-long-press-dragging { opacity: .78; transform: scale(.985); outline: 2px solid rgba(103,232,249,.72); outline-offset: 3px; }
.extension-widget-cell.is-resizing { z-index: 8; outline: 2px solid rgba(103,232,249,.78); outline-offset: 2px; }
.extension-widget-cell.is-widget-hidden { display: none; }
.extension-widget-grid.is-editing .is-widget-hidden { display: block; opacity: 0.4; }
.extension-widget-toolbar { position: absolute; top: -42px; right: 8px; z-index: 30; display: flex; justify-content: flex-end; }
.extension-widget-track { display: contents; }
.extension-widget-editor {
  position: absolute;
  top: 7px;
  right: 7px;
  left: 7px;
  z-index: 24;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 6px 8px;
  overflow-x: auto;
  border: 1px solid rgba(103,232,249,.34);
  border-radius: 11px;
  background: rgba(8,15,30,.88);
  box-shadow: 0 8px 24px rgba(2,6,23,.34);
  backdrop-filter: blur(16px);
  font-size: 11px;
  color: #a5f3fc;
  cursor: default;
  scrollbar-width: thin;
}
.extension-widget-stack-badge { flex: none; padding: 2px 6px; border-radius: 999px; background: var(--ext-accent-soft); color: var(--ext-accent); font-size: 9px; white-space: nowrap; }
.extension-widget-handle { cursor: grab; padding: 0 4px; gap: 2px; font-size: 10px; color: #67e8f9; user-select: none; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; }
.extension-widget-name { flex: none; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; color: #fff; }
.extension-widget-actions { display: flex; flex: none; align-items: center; gap: 4px; }
.extension-widget-actions button {
  min-width: max-content;
  height: 28px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(103,232,249,.28);
  border-radius: 7px;
  background: rgba(15,23,42,.85);
  color: #a5f3fc;
  font-size: 12px;
  gap: 3px;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease;
  touch-action: manipulation;
}
.extension-widget-actions button:hover { border-color: rgba(103,232,249,.6); background: rgba(30,41,59,.95); }
.extension-widget-actions button:disabled { cursor: default; opacity: .35; }
.widget-resize-handle {
  position: absolute;
  z-index: 20;
  padding: 0;
  border: 0;
  background: transparent;
  touch-action: none;
}
.widget-resize-handle.is-right { top: 14px; right: -6px; bottom: 14px; width: 12px; cursor: ew-resize; }
.widget-resize-handle.is-bottom { right: 14px; bottom: -6px; left: 14px; height: 12px; cursor: ns-resize; }
.widget-resize-handle.is-corner {
  right: -7px;
  bottom: -7px;
  width: 18px;
  height: 18px;
  border: 2px solid #67e8f9;
  border-top: 0;
  border-left: 0;
  border-radius: 0 0 5px;
  cursor: nwse-resize;
}
:global(html.is-widget-resizing),
:global(html.is-widget-resizing *) { cursor: nwse-resize !important; user-select: none !important; }
.extension-widget-actions button:focus-visible,
.extension-widget-list-item button:focus-visible,
.modal-secondary-action:focus-visible,
.modal-primary-action:focus-visible {
  outline: 2px solid #67e8f9;
  outline-offset: 2px;
}

@media (pointer: coarse), (max-width: 720px) {
  .extension-widget-grid { grid-template-columns: 1fr; }
  .widget-resize-handle.is-right { display: none; }
  .extension-widget-cell { grid-column: 1 / -1 !important; }
  .extension-widget-actions { flex-wrap: nowrap; }
  .extension-widget-actions button { min-width: max-content; height: 40px; padding: 0 9px; }
  .extension-widget-editor { min-height: 48px; padding: 6px 10px; }
  .extension-widget-handle { min-width: 32px; min-height: 32px; }
  .modal-secondary-action { min-height: 44px; padding: 10px 14px; }
  .extension-widget-list-item button { min-height: 44px; min-width: 44px; padding: 10px 12px; }
  .speed-card-edit { width: 28px; height: 28px; opacity: 1; transform: translateX(15px); }
}

.widget-manager-content { display: flex; flex-direction: column; gap: 10px; color: #e2e8f0; }
.widget-manager-content > p { margin: 0 0 4px; color: #94a3b8; font-size: 12px; }
.widget-choice { padding: 13px 14px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border: 1px solid rgba(255,255,255,.1); border-radius: 14px; background: rgba(15,23,42,.72); cursor: pointer; transition: border-color .2s ease, background .2s ease, transform .2s ease; }
.widget-choice:hover { border-color: rgba(52, 211, 153, .42); background: rgba(30, 41, 59, .9); transform: translateY(-1px); }
.widget-choice > span { min-width: 0; display: grid; grid-template-columns: 24px 1fr; align-items: center; column-gap: 8px; }
.widget-choice svg { grid-row: 1 / 3; color: #67e8f9; font-size: 18px; }
.widget-choice b { font-size: 13px; }
.widget-choice small { color: #64748b; font-size: 10px; }
.extension-widget-library { display: flex; flex-direction: column; gap: 9px; margin-top: 2px; padding: 13px 14px; border: 1px solid rgba(255,255,255,.1); border-radius: 14px; background: rgba(15,23,42,.72); }
.extension-widget-library > small { color: #64748b; font-size: 11px; }
.extension-widget-library-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.extension-widget-library-head > div { display: flex; min-width: 0; flex-direction: column; }
.extension-widget-library-head b { font-size: 13px; }
.extension-widget-library-head small { color: #64748b; font-size: 10px; }
.extension-widget-list { display: flex; flex-direction: column; gap: 6px; }
.extension-widget-list-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border-radius: 10px; background: rgba(30,41,59,.8); font-size: 12px; }
.extension-widget-list-item > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.extension-widget-list-item > div { display: flex; flex: none; gap: 5px; }
.extension-widget-list-item button,.modal-secondary-action { padding: 5px 9px; border: 1px solid rgba(103,232,249,.24); border-radius: 8px; background: rgba(15,23,42,.7); color: #a5f3fc; font-size: 11px; cursor: pointer; transition: border-color .2s ease, background .2s ease; }
.extension-widget-list-item button:hover,.modal-secondary-action:hover { border-color: rgba(103,232,249,.58); background: rgba(30,41,59,.96); }
.modal-primary-action { align-self: flex-end; min-width: 84px; padding: 9px 18px; border: 1px solid rgba(52, 211, 153, .42); border-radius: 12px; background: linear-gradient(135deg, #10b981, #059669); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 8px 24px rgba(5, 150, 105, .24); transition: transform .2s ease, filter .2s ease, box-shadow .2s ease; }
.modal-primary-action:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 12px 30px rgba(5, 150, 105, .32); }
.modal-primary-action:focus-visible { outline: 3px solid rgba(110, 231, 183, .38); outline-offset: 2px; }

:global(.extension-surface-modal .n-card-header) { padding: 17px 20px; border-bottom: 1px solid rgba(148, 163, 184, .14); color: #f8fafc; }
:global(.extension-surface-modal .n-card__content) { color: #e2e8f0; }
:global(.group-manager-modal .n-card__content) { height: calc(100% - 59px); overflow: hidden; }
:global(.wallpaper-manager-modal .n-card__content) { height: calc(100% - 59px); padding: 0; overflow: hidden; }


.card-icon-box {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--pn-bookmark-icon-radius, 15px);
  /* 图标素材自己决定底色；宿主不再额外铺白底或形成白色外圈。 */
  background: transparent;
  box-shadow: 0 7px 18px rgba(2,6,23,.28);
  overflow: hidden;
  transition: transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s ease, filter .2s ease;
}

.speed-card:hover .card-icon-box {
  transform: translateY(-4px) scale(1.045);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.38);
  filter: brightness(1.06);
}

.card-icon-box :deep(.item-icon),
.card-icon-box :deep(.n-avatar),
.card-icon-box :deep(.n-image),
.card-icon-box :deep(.n-image img) {
  width: 100% !important;
  height: 100% !important;
  border-radius: inherit !important;
}

.card-icon-box :deep(.n-image img) {
  object-fit: cover;
}

.card-info {
  width: min(100%, 94px);
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.card-title {
  font-size: 12px;
  font-weight: 550;
  line-height: 1.35;
  color: var(--pn-icon-default-color, #fff);
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: none;
}

@media (max-width: 700px) {
  .side-rail { width: 60px; padding-inline: 5px; }
  .rail-group-label { width: 44px; }
  .main-content { padding-left: 66px; }
  .sidebar-right .main-content { padding-right: 66px; padding-left: 1rem; }
  .sidebar-auto-hide .main-content { padding-left: 1rem; }
  .sidebar-right.sidebar-auto-hide .main-content { padding-right: 1rem; }
  .clock-hero { margin-top: 20px; }
  .active-group-meta small { display: none; }
  .cards-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px 6px; }
  .speed-card { padding-inline: 0; }
  :global(.extension-surface-modal .n-card-header) { padding: 14px 16px; }
  :global(.wallpaper-manager-modal .n-card__content) { height: calc(100% - 53px); }
}

@media (max-width: 430px) {
  .cards-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* Quiet workspace: one palette, restrained surfaces, generous spacing. */
.extension-tab-container {
  color: var(--ext-text);
  background: var(--ext-canvas);
}

.side-rail {
  inset: 50% auto auto 12px;
  translate: 0 -50%;
  width: 136px;
  max-height: calc(100dvh - 32px);
  padding: 12px;
  gap: 8px;
  color: var(--ext-text-muted);
  border: 1px solid var(--ext-border);
  border-radius: 20px;
  background: var(--ext-rail);
  box-shadow: var(--ext-elevation);
  backdrop-filter: none;
}

.sidebar-right .side-rail {
  inset: 50% 12px auto auto;
  border: 1px solid var(--ext-border);
  box-shadow: var(--ext-elevation);
}

.sidebar-compact .side-rail { width: 64px; padding-inline: 5px; }
.sidebar-compact .rail-avatar { width: 48px; }
.sidebar-compact .rail-avatar, .sidebar-compact .rail-group-button, .sidebar-compact .rail-settings { flex-direction: column; justify-content: center; }
.sidebar-compact .rail-group-label, .sidebar-compact .rail-avatar-label { width: 50px; text-align: center; font-size: 10px; }
.sidebar-compact .rail-group-button { min-height: 52px; padding: 5px 2px; gap: 3px; }
.sidebar-compact .rail-settings { gap: 3px; padding-inline: 0; }
.sidebar-compact .rail-avatar-frame { width: 36px; height: 36px; }
.sidebar-compact .rail-avatar-frame :deep(.n-avatar) { width: 36px !important; height: 36px !important; }
.sidebar-compact .rail-group-button, .sidebar-compact .rail-button { min-height: 40px; }

.side-rail:not(.revealed) { opacity: 0; pointer-events: none; transform: translateX(calc(-100% - 15px)); }
.sidebar-right .side-rail:not(.revealed) { transform: translateX(calc(100% + 15px)); }

.main-content {
  padding-top: 28px !important;
  padding-right: 52px !important;
  padding-left: 168px !important;
  transition: padding 220ms cubic-bezier(.2, .8, .2, 1);
}
.sidebar-right .main-content { padding-right: 168px !important; padding-left: 52px !important; }
.sidebar-auto-hide .main-content { padding-left: 52px !important; }
.sidebar-right.sidebar-auto-hide .main-content { padding-right: 52px !important; }
.sidebar-compact .main-content { padding-left: 96px !important; }
.sidebar-right.sidebar-compact .main-content { padding-right: 96px !important; padding-left: 52px !important; }
.sidebar-auto-hide.sidebar-compact .main-content { padding-left: 52px !important; }
.sidebar-right.sidebar-auto-hide.sidebar-compact .main-content { padding-right: 52px !important; }

.rail-avatar { position: relative; width: 100%; flex-direction: row; gap: 10px; padding: 3px 0; color: var(--ext-text-muted); }
.rail-avatar-frame { position: relative; display: block; flex: none; width: 42px; height: 42px; }
.rail-avatar-frame :deep(.n-avatar) {
  --pn-profile-avatar-color: #fff;
  border: 1px solid var(--ext-border);
  border-radius: 15px !important;
  color: #fff;
  background: var(--ext-accent);
  box-shadow: none;
}
.rail-avatar-status {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--ext-rail);
  border-radius: 50%;
  background: #8b98aa;
}
.rail-avatar-status.is-online { background: var(--ext-accent); }
.rail-avatar-status.is-syncing { background: var(--ext-accent); animation: extension-status-pulse 1.3s ease-in-out infinite; }
.rail-avatar-status.is-cached { background: var(--ext-text-soft); }
.rail-avatar-status.is-offline { background: #8b98aa; }
.rail-avatar-status.is-error { background: var(--ext-danger); }
.rail-avatar-label { color: var(--ext-text); font-size: 11px; width: auto; flex: 1; text-align: left; font-weight: 650; line-height: 1.4; }
.rail-divider { width: 100%; flex: none; margin: 3px 0; background: var(--ext-divider); }
.rail-group-button, .rail-button { color: var(--ext-text); border-radius: 14px; }
.rail-group-button { display: flex; align-items: center; justify-content: flex-start; flex: none; min-height: 42px; padding: 6px 8px; gap: 10px; border-radius: 12px; }
.rail-group-label { width: auto; min-width: 0; text-align: left; font-size: 12px; font-weight: 650; line-height: 1.4; }
.rail-groups { flex: 0 1 auto; gap: 4px; overscroll-behavior: contain; }
.rail-spacer { flex: none; width: 100%; min-height: 1px; height: 1px; background: var(--ext-divider); }
.rail-settings { width: 100%; min-height: 38px; flex-direction: row; justify-content: flex-start; gap: 10px; padding: 6px 8px; }
.rail-group-button:focus-visible, .rail-button:focus-visible, .rail-avatar:focus-visible { outline: 2px solid var(--ext-accent); outline-offset: 2px; }
.rail-button { font-size: 11px; font-weight: 650; }
.rail-group-button:hover, .rail-group-button.active, .rail-button:hover, .rail-button.active {
  color: var(--ext-text);
  background: var(--ext-surface-raised);
}
.rail-group-button.active { color: var(--ext-text); background: var(--ext-accent-soft); }
.rail-group-button.active::before { left: -7px; width: 3px; height: 26px; border-radius: 3px; background: var(--ext-accent); }
.sidebar-right .rail-group-button.active::before { right: -7px; }
.rail-group-icon {
  flex: none;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  color: inherit;
  background: var(--ext-surface-raised);
  font: 750 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.rail-group-button.active .rail-group-icon { color: var(--pn-sidebar-active-text-color, var(--ext-text)); border: 0; background: color-mix(in srgb, var(--ext-accent) 16%, transparent); }
.rail-group-add { color: var(--ext-text); }
.rail-group-add .rail-icon { color: var(--pn-sidebar-active-text-color, var(--ext-text)); }

.clock-hero { margin-top: clamp(28px, 5vh, 64px); margin-bottom: 30px; color: var(--ext-text); }
.time-display { font-family: "Aptos Display", "Segoe UI Variable", sans-serif; font-variant-numeric: tabular-nums; letter-spacing: -.055em; line-height: 1.12; }
.time-display > span:first-child { font-size: clamp(64px, 8vw, 108px) !important; font-weight: 300 !important; }
.clock-seconds { margin-left: 12px; color: var(--ext-text-soft); font-size: 22px !important; font-weight: 400; letter-spacing: 0; }
.clock-period { margin-left: 8px; color: var(--ext-text-muted); font-size: 12px; font-weight: 650; letter-spacing: 0; }
.date-display { margin-top: 14px; color: var(--ext-text-muted); font-size: 13px !important; letter-spacing: .08em; }
.clock-hero.text-shadow-md { text-shadow: none; }

.sync-status-banner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  margin: 0;
  padding: 3px 10px;
  border: 1px solid var(--ext-border);
  border-radius: 20px;
  color: var(--ext-text-muted);
  background: var(--ext-surface);
  box-shadow: var(--ext-elevation);
  font-size: 11px;
  width: auto;
}
.sync-status-banner > svg { color: var(--ext-accent); font-size: 14px; }
.sync-status-banner small { color: var(--ext-text-soft); }
.sync-status-banner button { padding: 2px 7px; border: 0; border-radius: 6px; color: var(--ext-accent); background: var(--ext-accent-soft); font-size: 11px; cursor: pointer; transition: opacity .15s ease; }
.sync-status-banner button:hover { opacity: .85; }
.sync-status-banner.is-error { border-color: var(--ext-danger); }
.sync-status-banner.is-error > svg { color: var(--ext-danger); }

.search-section { position: relative; z-index: 35; max-width: 640px; margin-bottom: 56px !important; }
.search-bar-capsule {
  min-height: 60px;
  padding: 5px 8px 5px 10px !important;
  border: 1px solid var(--ext-border);
  border-radius: 20px;
  color: var(--ext-text);
  background: var(--ext-surface);
  box-shadow: var(--ext-elevation);
  backdrop-filter: none;
}
.search-bar-capsule.is-focused { border-color: var(--ext-accent); box-shadow: 0 0 0 3px var(--ext-accent-soft), var(--ext-elevation); }
.extension-search-input { color: var(--ext-text); }
.extension-search-input::placeholder { color: var(--ext-text-soft); }
.engine-select-btn { color: var(--ext-text-muted); border-radius: 10px !important; }
.engine-select-btn:hover, .clear-btn:hover, .bookmark-search-trigger:hover { background: var(--ext-surface-raised) !important; }
.bookmark-search-trigger {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  margin-right: 4px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  color: var(--ext-text-muted);
  background: transparent;
  cursor: pointer;
}
.bookmark-search-trigger.active { color: var(--ext-accent); background: var(--ext-accent-soft); }
.search-submit-btn { background: var(--ext-accent) !important; box-shadow: none !important; }

.bookmark-search-panel {
  position: absolute;
  z-index: 42;
  top: calc(100% + 10px);
  left: 0;
  width: 100%;
  padding: 14px;
  border: 1px solid var(--ext-border);
  border-radius: 18px;
  color: var(--ext-text);
  background: var(--ext-surface);
  box-shadow: 0 18px 48px var(--ext-shadow);
}
.bookmark-search-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 11px; }
.bookmark-search-header > div { display: flex; flex-direction: column; }
.bookmark-search-header b { color: var(--ext-text); font-size: 12px; }
.bookmark-search-header small { margin-top: 2px; color: var(--ext-text-soft); font-size: 10px; }
.bookmark-search-header > button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--ext-border);
  border-radius: 9px;
  color: var(--ext-text-muted);
  background: var(--ext-surface-raised);
  cursor: pointer;
}
.bookmark-search-input-wrap {
  display: flex;
  min-height: 40px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--ext-border);
  border-radius: 12px;
  color: var(--ext-text-muted);
  background: var(--ext-surface-raised);
}
.bookmark-search-input-wrap:focus-within { border-color: var(--ext-accent); box-shadow: 0 0 0 3px var(--ext-accent-soft); }
.bookmark-search-input-wrap input { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--ext-text); background: transparent; font-size: 12px; }
.bookmark-search-input-wrap input::placeholder { color: var(--ext-text-soft); }
.bookmark-search-results { display: flex; max-height: 300px; flex-direction: column; gap: 4px; overflow-y: auto; margin-top: 10px; overscroll-behavior: contain; }
.bookmark-search-results > button {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 9px;
  border: 0;
  border-radius: 11px;
  color: var(--ext-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.bookmark-search-results > button:hover { background: var(--ext-accent-soft); }
.bookmark-result-icon { display: grid; width: 34px; height: 34px; place-items: center; overflow: hidden; border-radius: 9px; background: var(--ext-surface-raised); }
.bookmark-result-copy { display: flex; min-width: 0; flex-direction: column; }
.bookmark-result-copy b, .bookmark-result-copy small { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.bookmark-result-copy b { font-size: 11px; }
.bookmark-result-copy small { margin-top: 2px; color: var(--ext-text-soft); font-size: 9px; }
.bookmark-result-open { color: var(--ext-text-soft); font-size: 13px; }
.bookmark-search-empty { padding: 22px 10px 12px; color: var(--ext-text-soft); font-size: 11px; text-align: center; }
.bookmark-search-panel-enter-active, .bookmark-search-panel-leave-active { transition: opacity 150ms ease, transform 150ms ease; }
.bookmark-search-panel-enter-from, .bookmark-search-panel-leave-to { opacity: 0; transform: translateY(-5px); }

.active-group-meta { margin: 0 3px 10px; color: var(--ext-text); text-shadow: none; }
.active-group-meta > span { font-size: 18px; font-weight: 600; letter-spacing: .02em; }
.active-group-meta small { margin-top: 5px; color: var(--ext-text-soft); font-size: 11px; }
.extension-widget-grid { --widget-grid-row-height: 76px; gap: 12px; padding: 0 0 8px; }
.extension-widget-cell { border-radius: 20px; }
.extension-widget-toolbar {
  position: sticky;
  top: 0;
  z-index: 30;
  grid-column: 1 / -1;
  width: max-content;
  max-width: calc(100vw - 32px);
  margin: -42px auto 12px;
  padding: 7px 8px 7px 12px;
  border: 1px solid var(--ext-border);
  border-radius: 14px;
  color: var(--ext-text);
  background: var(--ext-surface);
  box-shadow: 0 10px 28px var(--ext-shadow);
}
.extension-edit-mode-copy { display: flex; min-width: 0; flex-direction: column; padding-right: 6px; }
.extension-edit-mode-copy strong { color: var(--ext-text); font-size: 11px; }
.extension-edit-mode-copy small { margin-top: 1px; color: var(--ext-text-soft); font-size: 9px; white-space: nowrap; }
.modal-secondary-action { border-color: var(--ext-border); color: var(--ext-text-muted); background: var(--ext-surface-raised); }
.modal-secondary-action:hover { border-color: var(--ext-accent); color: var(--ext-accent); background: var(--ext-accent-soft); }
.extension-widget-grid.is-editing .extension-widget-cell { outline-color: var(--ext-accent); border-radius: 20px; }
.extension-widget-empty { color: var(--ext-text-muted) !important; border-color: var(--ext-border) !important; background: var(--ext-surface) !important; }
.extension-widget-editor {
  top: 8px;
  right: 8px;
  left: auto;
  max-width: calc(100% - 16px);
  padding: 5px 6px;
  border-color: var(--ext-border);
  border-radius: 11px;
  color: var(--ext-accent);
  background: var(--ext-surface-raised);
  box-shadow: 0 8px 24px var(--ext-shadow);
  backdrop-filter: none;
}
.extension-widget-handle { color: var(--ext-accent); }
.extension-widget-name { max-width: 110px; color: var(--ext-text); }
.extension-widget-size { flex: none; padding: 2px 6px; border-radius: 999px; color: var(--ext-accent); background: var(--ext-accent-soft); font-size: 9px; font-weight: 750; }
.extension-widget-actions button { width: 28px; min-width: 28px; height: 28px; padding: 0; border-color: var(--ext-border); color: var(--ext-text-muted); background: var(--ext-surface); }
.extension-widget-actions button.is-labelled { width: auto; min-width: 40px; padding: 0 8px; font-size: 10px; font-weight: 700; }
.extension-widget-actions button span { display: none; }
.extension-widget-actions button:hover { border-color: var(--ext-accent); color: var(--ext-accent); background: var(--ext-accent-soft); }
.extension-widget-editor.is-compact .extension-widget-name,
.extension-widget-editor.is-compact .extension-widget-actions .is-labelled { display: none; }
.widget-resize-handle.is-corner { border-color: var(--ext-accent); }

.cards-grid { grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); grid-auto-rows: 90px; gap: 18px 12px; padding: 5px 0 18px; }
.speed-card { gap: 7px; border-radius: 14px; color: var(--ext-text); }
.speed-card.is-expanded:hover { background: var(--ext-surface-raised); }
.speed-card.is-expanded { background: var(--ext-surface); border: 1px solid var(--ext-border); box-shadow: 0 10px 28px var(--ext-shadow); backdrop-filter: none; }
.card-icon-box { width: 56px; height: 56px; border-radius: var(--pn-bookmark-icon-radius, 16px); box-shadow: var(--pn-effect-shadow-low); }
.card-title { color: var(--ext-text); font-size: 12px; font-weight: 550; }
.card-description { color: var(--ext-text-soft); }
.speed-card-edit { border-color: var(--ext-border); color: var(--ext-text); background: var(--ext-surface-raised); box-shadow: 0 3px 10px var(--ext-shadow); }

.extension-context-menu {
  width: 228px;
  padding: 7px;
  color: var(--ext-text);
  border-color: var(--ext-border);
  border-radius: 16px;
  background: var(--ext-surface);
  box-shadow: var(--pn-effect-shadow-high);
  backdrop-filter: none;
}
.extension-context-menu:focus-visible,
.extension-widget-cell:focus-visible,
.speed-card:focus-visible { outline: 2px solid var(--ext-accent); outline-offset: 3px; }
.widget-context-menu { width: 248px; background: var(--ext-surface); }
.context-menu-row { min-height: 34px; padding: 0 9px; color: var(--ext-text); border-radius: 9px; font-size: 12px; }
.context-menu-row:hover { color: var(--ext-text); background: var(--ext-surface-raised); }
.context-menu-row.danger { color: var(--ext-danger); }
.context-menu-title, .context-menu-heading span { color: var(--ext-text); }
.context-menu-heading small { color: var(--ext-accent); background: var(--ext-accent-soft); }
.context-size-grid button { min-width: 36px; border: 1px solid var(--ext-border); border-radius: 8px; color: var(--ext-text-muted); background: var(--ext-surface-raised); }
.context-size-grid button:hover, .context-size-grid button.active { color: var(--ext-accent); border-color: var(--ext-accent); background: var(--ext-accent-soft); }
.context-menu-divider { background: var(--ext-divider); }
.context-menu-note { color: var(--ext-text-soft); }
.wheel-switch-hint { color: var(--ext-text); border-color: var(--ext-border); background: var(--ext-surface); box-shadow: 0 10px 35px var(--ext-shadow); backdrop-filter: none; }
.wheel-switch-hint small { color: var(--ext-text-soft); }
.empty-state { color: var(--ext-text-muted) !important; }
.engine-select-btn :deep(svg), .clear-btn :deep(svg) { color: var(--ext-text-muted) !important; }

:global(.extension-surface-modal) {
  color: var(--pn-color-text-secondary);
  border: 1px solid var(--pn-color-border);
  background: var(--pn-modal-background);
  box-shadow: var(--pn-effect-shadow-high);
}
:global(html:not(.dark) .extension-surface-modal) {
  color: var(--pn-color-text-secondary);
  border-color: var(--pn-color-border);
  background: var(--pn-modal-background);
  box-shadow: var(--pn-effect-shadow-high);
}
:global(.extension-surface-modal .n-card-header) { color: inherit; border-color: currentColor; border-bottom-color: rgba(143,157,177,.18); }
:global(.extension-surface-modal .n-card__content) { color: inherit; }
.widget-manager-content { color: var(--ext-text); }
.widget-manager-content > p, .extension-widget-library > small, .extension-widget-library-head small { color: var(--ext-text-soft); }
.widget-manager-page-scope { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--ext-border); border-radius: 13px; color: var(--ext-accent); background: var(--ext-accent-soft); }
.widget-manager-page-scope > svg { width: 18px; height: 18px; flex: none; }
.widget-manager-page-scope > span { min-width: 0; display: flex; flex-direction: column; }
.widget-manager-page-scope b { overflow: hidden; color: var(--ext-text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.widget-manager-page-scope small { margin-top: 2px; color: var(--ext-text-soft); font-size: 10px; }
.widget-choice, .extension-widget-library { color: var(--ext-text); border-color: var(--ext-border); background: var(--ext-surface); }
.widget-choice:hover { border-color: var(--ext-accent); background: var(--ext-accent-soft); }
.widget-choice svg { color: var(--ext-accent); }
.widget-choice small { color: var(--ext-text-soft); }
.extension-widget-list-item { color: var(--ext-text); background: var(--ext-surface-raised); }
.extension-widget-list-item button { color: var(--ext-accent); border-color: var(--ext-border); background: var(--ext-surface); }
.modal-primary-action { border-color: var(--ext-accent); background: var(--ext-accent); box-shadow: none; color: var(--pn-color-surface); }

@keyframes extension-status-pulse {
  50% { opacity: .4; transform: scale(.82); }
}

@media (min-width: 768px) {
  .cards-grid { grid-template-columns: repeat(auto-fill, minmax(82px, 1fr)); gap: 20px 14px; }
}

@media (max-width: 720px) {
  .side-rail { left: 8px; max-height: calc(100dvh - 24px); border-radius: 18px; }
  .sidebar-right .side-rail { right: 8px; left: auto; }
  .main-content { padding: 24px 20px 32px 84px !important; }
  .sidebar-right .main-content { padding-right: 84px !important; padding-left: 14px !important; }
  .sidebar-compact .main-content { padding-left: 84px !important; }
  .sidebar-right.sidebar-compact .main-content { padding-right: 84px !important; padding-left: 14px !important; }
  .sidebar-auto-hide .main-content { padding-left: 14px !important; }
  .sidebar-right.sidebar-auto-hide .main-content { padding-right: 14px !important; }
  .sidebar-auto-hide.sidebar-compact .main-content { padding-left: 14px !important; }
  .sidebar-right.sidebar-auto-hide.sidebar-compact .main-content { padding-right: 14px !important; }
  .extension-widget-toolbar { margin-top: -36px; }
  .extension-edit-mode-copy small { display: none; }
  .cards-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

@media (max-width: 430px) {
  .clock-hero { margin-top: 4px; }
  .time-display > span:first-child { font-size: 42px !important; }
  .cards-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .extension-edit-mode-copy { display: none; }
}

/* Shared page canvas: bookmarks and widgets consume the exact same grid unit. */
.dashboard-canvas-section { max-width: 1080px; margin-bottom: 32px; }
.dashboard-group-page { width: 100%; }
.group-slide-next-enter-active, .group-slide-previous-enter-active {
  transition: transform 240ms cubic-bezier(.2, .7, .2, 1), opacity 240ms ease;
}
.group-slide-next-leave-active, .group-slide-previous-leave-active {
  transition: transform 160ms ease-in, opacity 160ms ease-in;
  pointer-events: none;
}
.group-slide-next-enter-from, .group-slide-previous-leave-to { opacity: 0; transform: translateY(36px); }
.group-slide-next-leave-to, .group-slide-previous-enter-from { opacity: 0; transform: translateY(-36px); }
@media (prefers-reduced-motion: reduce) {
  .group-slide-next-enter-active, .group-slide-previous-enter-active,
  .group-slide-next-leave-active, .group-slide-previous-leave-active { transition-duration: 1ms; }
  .group-slide-next-enter-from, .group-slide-previous-leave-to,
  .group-slide-next-leave-to, .group-slide-previous-enter-from { transform: none; }
}
.dashboard-canvas-header {
  min-height: 42px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dashboard-canvas-header .active-group-meta { min-width: 0; margin: 0 3px; display: flex; flex-direction: column; }
.dashboard-canvas-header .active-group-meta > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dashboard-canvas-header .extension-widget-toolbar {
  position: static;
  width: auto;
  max-width: min(100%, 680px);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
}
.extension-dashboard-grid {
  --widget-grid-row-height: 100px;
  --dashboard-columns: 12;
  --dashboard-column-width: calc((100cqw - (var(--dashboard-columns) - 1) * 12px) / var(--dashboard-columns));
  --dashboard-icon-size: min(64px, var(--dashboard-column-width));
  --dashboard-icon-inset: max(0px, (var(--dashboard-column-width) - var(--dashboard-icon-size)) / 2);
  --dashboard-caption-space: calc(var(--widget-grid-row-height) - var(--dashboard-icon-size));
  container-type: inline-size;
  position: relative;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-flow: dense;
  grid-auto-rows: var(--widget-grid-row-height);
  gap: 12px;
  width: 100%;
  min-height: var(--widget-grid-row-height);
  padding: 5px 0 18px;
}
.extension-dashboard-track { display: contents; }
.dashboard-canvas-item { min-width: 0; min-height: 0; }
.dashboard-add-icon { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 7px; grid-column: span 1; grid-row: span 1; min-width: 0; min-height: 0; padding: 3px 2px 6px; border: 0; border-radius: 14px; color: var(--ext-text-muted); background: transparent; cursor: pointer; font: inherit; font-size: 12px; font-weight: 500; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 1px 6px rgba(0, 0, 0, 0.55); transition: none; }
.dashboard-add-icon:hover { transform: none; }
.dashboard-add-icon { text-shadow: none; }
.dashboard-add-icon:hover .dashboard-add-icon-symbol { transform: translateY(-4px) scale(1.045); box-shadow: 0 12px 26px rgba(0, 0, 0, 0.38); }
.dashboard-add-icon:focus-visible { outline: 2px solid var(--ext-accent); outline-offset: 3px; }
.dashboard-add-icon-symbol { display: grid; width: 54px; height: 54px; place-items: center; border: 1px dashed var(--ext-border); border-radius: var(--pn-bookmark-icon-radius, 14px); background: var(--ext-surface); box-shadow: none; transition: transform 180ms ease, box-shadow 180ms ease; }
.dashboard-add-icon-symbol svg { box-sizing: border-box; width: 36px; height: 36px; padding: 7px; border-radius: 50%; color: var(--pn-color-surface); background: var(--ext-accent); }
.extension-dashboard-grid .extension-widget-cell { height: 100%; padding-inline: var(--dashboard-icon-inset); border-radius: 20px; }
.extension-dashboard-grid .extension-widget-cell :deep(.widget-stack-host) { height: calc(100% - var(--dashboard-caption-space)); }
/* A multi-row card ends at the last row's icon edge, with the same label baseline. */
.dashboard-widget-caption { display: block; box-sizing: border-box; height: var(--dashboard-caption-space); padding-top: 10px; overflow: hidden; color: var(--ext-text); font-size: 12px; font-weight: 550; line-height: 16px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.extension-dashboard-grid .speed-card, .extension-dashboard-grid .dashboard-add-icon { padding: 0; gap: 10px; }
.extension-dashboard-grid .speed-card { justify-content: flex-start; }
.extension-dashboard-grid .card-title { line-height: 16px; }
.extension-dashboard-grid .card-icon-box, .extension-dashboard-grid .dashboard-add-icon-symbol { flex: none; width: var(--dashboard-icon-size); height: var(--dashboard-icon-size); }
.extension-dashboard-grid .card-icon-box { overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18); }
.extension-dashboard-grid.is-editing .extension-widget-cell {
  outline: 1px dashed color-mix(in srgb, var(--ext-accent) 58%, transparent);
  outline-offset: 2px;
}
.extension-dashboard-grid.is-editing .extension-widget-cell.is-widget-hidden { display: block; opacity: .42; }
.extension-dashboard-grid .extension-widget-empty {
  grid-column: 1 / -1;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px dashed var(--ext-border);
  border-radius: 20px;
  color: var(--ext-text-muted);
  background: var(--ext-surface);
}
.extension-dashboard-grid .extension-widget-empty p { margin: 0; color: var(--ext-text); font-size: 13px; font-weight: 700; }
.extension-dashboard-grid .extension-widget-empty small { color: var(--ext-text-soft); font-size: 10px; }
.extension-dashboard-grid .extension-widget-empty button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; margin-top: 6px; padding: 8px 14px; border: 1px solid color-mix(in srgb, var(--ext-accent) 45%, transparent); border-radius: var(--pn-radius-medium, 12px); color: var(--ext-text); background: color-mix(in srgb, var(--ext-accent) 18%, transparent); cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; }
.extension-dashboard-grid .extension-widget-empty button:hover { background: color-mix(in srgb, var(--ext-accent) 27%, transparent); }
.extension-dashboard-grid .extension-widget-empty button:focus-visible { outline: 2px solid var(--ext-accent); outline-offset: 3px; }
.extension-dashboard-grid .extension-widget-empty button svg { width: 16px; height: 16px; }
.is-dashboard-dragging {
  z-index: 40;
  opacity: .82;
  transform: scale(.97);
  outline: 2px solid var(--ext-accent) !important;
  outline-offset: 3px;
}

/* Keep the shared 12-column widget grid, but reserve usable icon width on laptops. */
@media (min-width: 721px) and (max-width: 1000px) {
  .extension-dashboard-grid { --dashboard-columns: 6; grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .extension-dashboard-grid .extension-widget-cell { grid-column: span min(var(--widget-columns), 6) !important; }
}

@media (max-width: 720px) {
  .dashboard-canvas-header { align-items: center; flex-wrap: wrap; }
  .dashboard-canvas-header .active-group-meta { flex: 1; }
  .dashboard-canvas-header .extension-widget-toolbar { flex: none; max-width: 100%; margin-left: auto; padding: 5px; justify-content: flex-end; }
  .dashboard-canvas-section { min-width: 0; }
  .extension-dashboard-grid { --dashboard-columns: 4; min-width: 0; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .extension-dashboard-grid .extension-widget-cell { grid-column: 1 / -1 !important; }
}

@media (max-width: 430px) {
  .extension-dashboard-grid { --dashboard-columns: 3; grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (prefers-reduced-motion: reduce) {
  .side-rail, .main-content, .rail-avatar-status { transition: none !important; animation: none !important; }
}

.workspace-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  width: 100%;
  gap: 16px;
  min-height: 36px;
}
.workspace-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 15px;
  letter-spacing: -.03em;
  cursor: pointer;
  text-align: left;
  transition: opacity 150ms ease;
}
.workspace-brand:hover { opacity: 0.85; }
.workspace-brand:hover .workspace-brand-mark { border-color: var(--ext-accent); background: var(--ext-accent-soft); }
.workspace-brand:focus-visible { outline: 2px solid var(--ext-accent); outline-offset: 3px; border-radius: 9px; }
.workspace-brand b { font-weight: 650; }
.workspace-brand-mark { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--ext-border); border-radius: 9px; color: var(--ext-accent); background: var(--ext-surface); transition: border-color 150ms ease, background-color 150ms ease; }
.workspace-brand-mark svg { width: 17px; height: 17px; }
.clock-eyebrow { margin: 0 0 18px; color: var(--ext-text-soft); font-size: 12px; letter-spacing: .22em; }
.extension-search-input { min-width: 0; width: 0; height: 40px; padding-block: 0 !important; border: 0 !important; border-radius: 0 !important; outline: 0 !important; box-shadow: none !important; appearance: none; -webkit-appearance: none; background: transparent !important; font: inherit; font-size: 15px; color: var(--ext-text); }
.search-submit-btn { display: grid; place-items: center; width: 40px; height: 40px; flex: none; border-radius: 13px; color: var(--pn-color-surface); }
.search-submit-btn:hover { filter: brightness(.93); }
.engine-select-btn { min-height: 40px; }
.dashboard-canvas-header .extension-widget-toolbar { gap: 6px; padding: 0; border: 0; background: transparent; box-shadow: none; backdrop-filter: none; }
.extension-widget-toolbar .modal-secondary-action { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 6px 11px; border: 1px solid var(--ext-border); border-radius: 10px; background: var(--ext-surface); color: var(--ext-text-muted); font-size: 12px; font-weight: 500; box-shadow: none; }
.extension-widget-toolbar .modal-secondary-action:hover { color: var(--ext-accent); border-color: var(--ext-accent); }
.canvas-add-action svg { width: 16px; height: 16px; }
.speed-card { gap: 10px; }
.speed-card.is-expanded:hover { background: color-mix(in srgb, var(--ext-surface) 70%, transparent); }
.speed-card:hover .card-icon-box { transform: translateY(-4px) scale(1.045); box-shadow: 0 12px 26px rgba(0, 0, 0, 0.38); filter: brightness(1.06); }
.card-icon-box { transition: transform 180ms ease, box-shadow 180ms ease, filter 180ms ease; }
.dashboard-add-icon-symbol svg { background: transparent; color: var(--ext-text-soft); width: 32px; height: 32px; padding: 4px; }
.workspace-footer { display: flex; align-items: center; justify-content: space-between; flex: none; gap: 16px; width: min(100%, 1080px); margin-top: auto; padding-top: 40px; color: var(--ext-text-soft); font-size: 11px; letter-spacing: .04em; }
.modal-secondary-action:focus-visible, .search-submit-btn:focus-visible, .engine-select-btn:focus-visible, .bookmark-search-trigger:focus-visible { outline: 2px solid var(--ext-accent); outline-offset: 3px; }
.main-content { scrollbar-width: thin; scrollbar-color: var(--ext-border) transparent; }

/* Wallpaper changes the canvas contrast, never the contrast inside controls. */
.has-wallpaper :is(.clock-hero, .active-group-meta, .workspace-brand, .card-title, .dashboard-add-icon, .workspace-footer) { color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5); }
.has-wallpaper :is(.clock-eyebrow, .clock-seconds, .clock-period, .date-display, .active-group-meta small, .card-description) { color: rgba(255, 255, 255, 0.92); text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5); }
.has-wallpaper .speed-card.is-expanded :is(.card-title, .card-description) { color: var(--ext-text); text-shadow: none; }
.has-wallpaper .dashboard-widget-caption { color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5); }
.has-wallpaper .sync-status-banner { color: var(--ext-text); background: var(--ext-surface); text-shadow: none; }

@media (max-width: 720px) {
  .sync-status-banner small { display: none; }
  .side-rail { width: 60px; padding: 10px 4px; }
  .rail-avatar, .rail-group-button, .rail-settings { flex-direction: column; justify-content: center; gap: 4px; padding-inline: 2px; }
  .rail-avatar-label, .rail-group-label { max-width: 48px; text-align: center; font-size: 10px; }
  .rail-avatar-frame { width: 36px; height: 36px; }
  .rail-avatar-frame :deep(.n-avatar) { width: 36px !important; height: 36px !important; }
  .rail-group-button { min-height: 52px; }
  .rail-settings { min-height: 48px; }
  .clock-hero { margin-top: 36px; }
  .clock-eyebrow { font-size: 11px; letter-spacing: .1em; }
  .search-section { margin-bottom: 32px !important; }
  .search-bar-capsule { min-height: 54px; padding-inline: 6px !important; }
  .extension-search-input { padding-inline: 6px; font-size: 13px; }
  .workspace-brand { font-size: 13px; }
  .dashboard-canvas-header { margin-bottom: 16px; }
  .workspace-footer { padding-top: 24px; }
}
@media (max-width: 430px) {
  .time-display > span:first-child { font-size: clamp(48px, 16vw, 64px) !important; }
  .clock-seconds { font-size: 18px !important; }
  .date-display { font-size: 11px !important; letter-spacing: 0; }
  .dashboard-canvas-header .active-group-meta { flex-basis: 100%; }
  .dashboard-canvas-header .extension-widget-toolbar { margin-left: 0; }
  .active-group-meta > span { font-size: 16px; }
  .active-group-meta small { font-size: 10px; }
  .workspace-footer > span { max-width: 50%; }
}
@media (prefers-reduced-motion: reduce) {
  .extension-tab-container *, .extension-tab-container *::before { animation: none !important; transition: none !important; }
}

/* Blur only independent surfaces, not every child, to avoid stacked GPU layers. */
.side-rail, .search-bar-capsule, .bookmark-search-panel,
.sync-status-banner, .extension-widget-toolbar, .extension-widget-editor,
.extension-context-menu, .wheel-switch-hint, .speed-card.is-expanded {
  -webkit-backdrop-filter: var(--pn-glass-filter);
  backdrop-filter: var(--pn-glass-filter);
  box-shadow: var(--pn-glass-highlight), var(--ext-elevation);
}
.extension-widget-editor { background: var(--pn-glass-surface); }
.dashboard-add-icon-symbol {
  -webkit-backdrop-filter: var(--pn-glass-control-filter);
  backdrop-filter: var(--pn-glass-control-filter);
  box-shadow: var(--pn-glass-highlight);
}
</style>
