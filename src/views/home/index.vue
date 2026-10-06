<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { NBackTop, NButton, NButtonGroup, NDropdown, NModal, NSkeleton, NSpin, useDialog, useMessage } from 'naive-ui'
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { AppIcon } from './components'
import { SystemMonitor } from '@/components/deskModule'
import { ConflictResolverModal } from '@/components/common'
import { deletes, getListByGroupId, saveSort } from '@/api/panel/itemIcon'
import { getList as getGroupList } from '@/api/panel/itemIconGroup'
import { set as setUserConfig } from '@/api/panel/userConfig'
import { enqueueAppearanceSave } from '@/themes/appearanceSaveQueue'
import { packageRevision } from '@/packages/manager'
import { useTheme as useThemeContext } from '@/themes/context'
import { themeRegistry } from '@/themes/registry'
import { resolveThemeWallpaper } from '@/themes/wallpaper'
import { useLoadedWallpaper } from '@/runtime/wallpaperLoader'

import { setTitle, updateLocalUserInfo } from '@/utils/cmn'
import { sanitizeUserHtml } from '@/utils/sanitizeHtml'
import { isLegacyBrandedFooter } from '@/utils/branding'
import { defaultFooterHtml } from '@/utils/defaultFooter'
import { useAppStore, useAuthStore, usePanelState, useUserStore } from '@/store'
import { PanelPanelConfigStyleEnum, PanelStateNetworkModeEnum } from '@/enums'
import { VisitMode } from '@/enums/auth'
import { persistentStorage } from '@/utils/storage'
import { router } from '@/router'
import { t } from '@/locales'
import { getRuntime } from '@/runtime'
import { readBootstrapSnapshot, refreshBootstrapSnapshot } from '@/sync/bootstrapCache'
import { getBootstrap, waitForSyncChange } from '@/api/sync'
import { onSyncConflict, setSyncRevision } from '@/sync/revision'
import { replayOfflineQueue } from '@/sync/offlineReplay'
import { getPendingMutationCount } from '@/sync/offlineQueue'
import type { ConflictDescriptor, ConflictResolutionChoice } from '@/sync/conflictResolver'
import type { DashboardGroup } from '@/dashboard/core'
import { createDashboardState, createItemSortRequest, filterDashboardGroups, isDesktopGroup, normalizeDashboardGroups, resolveItemUrl } from '@/dashboard/core'
import ThemeIcon from '@/themes/ThemeIcon.vue'
import { receiveSharedSettings } from '@/runtime/sharedSettings'
import type { WidgetDisplayGroup, WidgetInstance } from '@/widgets'
import { WidgetHost, WidgetStackHost, WidgetSettingsModal, applyWidgetDisplayOrder, buildWidgetDisplayGroups, canStackWidgets, clearWidgetStorage, createHeaderClockWidget, createHeaderSearchWidget, createHeaderWeatherWidget, createTrendingWidget, createCountdownWidget, generateWidgetInstanceId, moveWidgetWithinStack, normalizeWidgetStacks, resizeInstanceWithinBounds, serializeWidgetLayout, stackWidgets, unstackWidget, widgetRegistry } from '@/widgets'
import { useWidgetGridResize } from '@/widgets/useGridResize'

withDefaults(defineProps<{
  layout?: 'web' | 'extension'
}>(), {
  layout: 'web',
})

const ms = useMessage()
const dialog = useDialog()
const appStore = useAppStore()
const panelState = usePanelState()
const wallpaperTheme = useThemeContext()
const requestedWallpaper = computed(() => {
  void packageRevision.value
  const url = resolveThemeWallpaper(wallpaperTheme.selection, themeRegistry.get(wallpaperTheme.themeId), wallpaperTheme.resolvedMode, panelState.panelConfig.backgroundImageSrc)
  return url ? getRuntime().resolveUrl(url) : ''
})
const { displayed: activeWallpaper, error: wallpaperLoadError } = useLoadedWallpaper(requestedWallpaper)
watch(wallpaperLoadError, error => { if (error) ms.warning(error) })
const authStore = useAuthStore()
const userStore = useUserStore()
const runtime = getRuntime()
const AppStarter = defineAsyncComponent(() => import('./components/AppStarter/index.vue'))
const EditItem = defineAsyncComponent(() => import('./components/EditItem/index.vue'))
// Presentation-only catalog: mutations and persistence still use the active web runtime.
const IconGalleryModal = defineAsyncComponent(() => import('@/views/extension/components/IconGalleryModal.vue'))
const LoginForm = defineAsyncComponent(() => import('@/views/login/index.vue'))
const loginVisible = ref(false)
const loginBusy = ref(false)
const iconGalleryVisible = ref(false)
const iconGalleryGroupId = ref<number | null>(null)
const ThemeSettingsModal = defineAsyncComponent(() => import('@/themes/ThemeSettingsModal.vue'))

const scrollContainerRef = ref<HTMLElement | null>(null)

const editItemInfoShow = ref<boolean>(false)
const editItemInfoData = ref<Panel.ItemInfo | null>(null)
const windowShow = ref<boolean>(false)
const windowSrc = ref<string>('')
const windowTitle = ref<string>('')

const windowIframeIsLoad = ref<boolean>(false)

const dropdownMenuX = ref(0)
const dropdownMenuY = ref(0)
const dropdownShow = ref(false)
const currentRightSelectItem = ref<Panel.ItemInfo | null>(null)
const currentAddItenIconGroupId = ref<number | undefined>()
const bookmarkDragSnapshots = new WeakMap<DashboardGroup, Panel.ItemInfo[]>()
let suppressBookmarkClickUntil = 0

const settingModalShow = ref(false)
const themeCenterVisible = ref(false)
const safeFooterHtml = computed(() => {
  const raw = panelState.panelConfig.footerHtml || defaultFooterHtml
  if (isLegacyBrandedFooter(raw))
    return sanitizeUserHtml(defaultFooterHtml)
  return sanitizeUserHtml(raw)
})

const items = ref<DashboardGroup[]>([])
const catalogPages = computed(() => items.value.filter(isDesktopGroup).flatMap(group => typeof group.id === 'number' ? [{ id: group.id, title: group.title || '' }] : []))
const filterItems = ref<DashboardGroup[]>([])
const searchKeyword = ref('')
const groupsLoaded = ref(false)
const groupsLoadFailed = ref(false)
const browserOnline = ref(navigator.onLine)
type ExtensionSyncStatus = 'idle' | 'syncing' | 'online' | 'cached' | 'offline' | 'error'
const extensionSyncStatus = ref<ExtensionSyncStatus>(runtime.kind === 'extension' ? 'syncing' : 'idle')
const lastSyncAt = ref<string | null>(null)
let hasCachedSnapshot = false
let extensionRefreshPromise: Promise<void> | null = null
let removeSyncConflictListener: (() => void) | null = null
let webSyncRevision: Sync.Revision = '0'
let webSyncWatchController: AbortController | null = null
let webSyncWatchRunning = false
let webBootstrapRefreshPromise: Promise<void> | null = null
let isDisposed = false

// 离线队列与冲突解决
const conflictModalVisible = ref(false)
const currentConflict = ref<ConflictDescriptor | null>(null)
let conflictResolverPromiseResolve: ((choice: ConflictResolutionChoice) => void) | null = null

const pendingMutationsCount = computed(() => {
  const accountId = authStore.userInfo?.id
  return accountId ? getPendingMutationCount(accountId) : 0
})

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
  if (result.succeeded > 0) {
    ms.success(`已成功同步 ${result.succeeded} 项离线修改`)
    if (runtime.kind === 'extension')
      void refreshExtensionBootstrap()
    else
      void getList()
  }
  if (result.interrupted && result.error && navigator.onLine)
    ms.warning(`同步已暂停：${result.error}`)
}

const canEdit = computed(() => authStore.visitMode === VisitMode.VISIT_MODE_LOGIN
  && (runtime.kind !== 'extension' || extensionSyncStatus.value === 'online'))

const extensionSyncLabel = computed(() => {
  const labels: Record<Exclude<ExtensionSyncStatus, 'idle'>, string> = {
    syncing: t('panelHome.syncing'),
    online: t('panelHome.syncOnline'),
    cached: t('panelHome.syncCached'),
    offline: t('panelHome.syncOffline'),
    error: t('panelHome.syncUnavailable'),
  }
  return extensionSyncStatus.value === 'idle' ? '' : labels[extensionSyncStatus.value]
})
const extensionSyncTitle = computed(() => lastSyncAt.value
  ? t('panelHome.syncLastAt', { time: new Date(lastSyncAt.value).toLocaleString() })
  : extensionSyncLabel.value)
const runtimeLabel = computed(() => runtime.kind === 'extension' ? t('panelHome.runtimeExtension') : t('panelHome.runtimeWeb'))
const networkLabel = computed(() => browserOnline.value ? t('panelHome.networkOnline') : t('panelHome.networkOffline'))
const sessionLabel = computed(() => {
  if (authStore.visitMode === VisitMode.VISIT_MODE_PUBLIC)
    return t('panelHome.sessionPublic')
  return authStore.authMode === 'device' ? t('panelHome.sessionDevice') : t('panelHome.sessionLegacy')
})
const sessionTitle = computed(() => authStore.accessExpiresAt
  ? t('panelHome.sessionExpiresAt', { time: new Date(authStore.accessExpiresAt).toLocaleString() })
  : sessionLabel.value)
const headerClockWidget = computed(() => createHeaderClockWidget(!panelState.panelConfig.clockShowSecond))
const homeIconTextColor = computed(() => !activeWallpaper.value && panelState.panelConfig.iconTextColor?.toLowerCase() === '#ffffff'
  ? 'var(--pn-color-text-primary)'
  : panelState.panelConfig.iconTextColor)
// Header search follows the active palette; widget instances keep their own overrides.
const headerSearchWidget = { ...createHeaderSearchWidget(), config: {} }
const headerWeatherWidget = createHeaderWeatherWidget()

const widgetInstances = ref<WidgetInstance[]>([])
const widgetEditMode = ref(false)
const widgetLayoutDirty = ref(false)
const widgetLayoutSaving = ref(false)
const quarantinedWidgets = ref<unknown[]>([])
const widgetLayoutLoadError = ref(false)
const pendingWidgetStorageCleanup = new Set<string>()
const widgetSettingsVisible = ref(false)
const widgetSettingsInstance = ref<WidgetInstance | null>(null)

function createDefaultWidgetInstances(): WidgetInstance[] {
  return [createTrendingWidget(), createCountdownWidget(t('countdown.newYearDay'), '2027-01-01', 'yearly')]
}

function buildWidgetInstances(stored: unknown): WidgetInstance[] {
  if (!stored) {
    quarantinedWidgets.value = []
    widgetLayoutLoadError.value = false
    return createDefaultWidgetInstances()
  }
  try {
    const result = widgetRegistry.loadLayout(stored)
    quarantinedWidgets.value = result.quarantinedWidgets
    widgetLayoutLoadError.value = false
    if (result.droppedWidgetIds.length)
      console.warn('Dropped invalid widget instances.', result.droppedWidgetIds)
    if (result.issues.length)
      console.warn('Quarantined incompatible widget instances.', result.issues)
    return result.layout.widgets
  }
  catch (error) {
    widgetLayoutLoadError.value = true
    console.warn('Unable to load this widget layout without data loss.', error)
    return createDefaultWidgetInstances()
  }
}

// 布局来自面板配置，随 bootstrap/增量同步刷新；编辑中的未保存改动不被后台刷新覆盖。
watch(() => panelState.panelConfig.widgets, (stored) => {
  if (widgetEditMode.value && widgetLayoutDirty.value)
    return
  widgetInstances.value = buildWidgetInstances(stored)
}, { immediate: true })

watch(packageRevision, () => {
  if (!widgetEditMode.value || !widgetLayoutDirty.value)
    widgetInstances.value = buildWidgetInstances(panelState.panelConfig.widgets)
})

const visibleWidgetGroups = computed<WidgetDisplayGroup[]>({
  get: () => buildWidgetDisplayGroups(widgetInstances.value),
  set: (groups) => {
    applyWidgetDisplayOrder(widgetInstances.value, groups.map(group => group.key))
    widgetInstances.value = [...widgetInstances.value]
  },
})

const widgetAddOptions = computed(() => { void packageRevision.value; return widgetRegistry.list()
  .filter(definition => !definition.surfaces || definition.surfaces.includes(runtime.kind))
  .map(definition => ({
  label: widgetDefinitionTitle(definition),
  key: definition.type,
})) })

// 标准化接口：优先读取组件自描述 meta.title（i18n key 或字面文案），回退到内置语言包
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

function widgetTypeLabel(type: string) {
  return widgetDefinitionTitle(widgetRegistry.get(type) ?? { type })
}

function widgetCellStyle(value: { size: WidgetInstance['size'] }) {
  const columns = Math.min(Math.max(value.size.columns, 1), 12)
  return {
    gridColumn: `span ${columns} / span ${columns}`,
    gridRow: `span ${Math.max(value.size.rows, 1)}`,
  }
}

function widgetStackTargetOptions(instance: WidgetInstance) {
  const seen = new Set<string>()
  return widgetInstances.value.flatMap((target) => {
    const key = target.stack?.id ?? target.id
    if (seen.has(key) || !canStackWidgets(widgetInstances.value, instance.id, target.id))
      return []
    seen.add(key)
    const count = target.stack ? widgetInstances.value.filter(candidate => candidate.stack?.id === target.stack?.id).length : 1
    return [{
      key: target.id,
      label: count > 1 ? `${widgetTypeLabel(target.type)} (${count})` : widgetTypeLabel(target.type),
    }]
  })
}

function stackWidgetWith(instance: WidgetInstance, targetId: string | number) {
  if (!stackWidgets(widgetInstances.value, instance.id, String(targetId)))
    return
  widgetInstances.value = [...widgetInstances.value]
  widgetLayoutDirty.value = true
}

function removeWidgetFromStack(instance: WidgetInstance) {
  if (!unstackWidget(widgetInstances.value, instance.id))
    return
  widgetInstances.value = [...widgetInstances.value]
  widgetLayoutDirty.value = true
}

function moveStackMember(instance: WidgetInstance, delta: number) {
  if (!moveWidgetWithinStack(widgetInstances.value, instance.id, delta))
    return
  widgetInstances.value = [...widgetInstances.value]
  widgetLayoutDirty.value = true
}

function isLastWidgetStackMember(instance: WidgetInstance) {
  if (!instance.stack)
    return true
  const count = widgetInstances.value.filter(member => member.stack?.id === instance.stack?.id).length
  return instance.stack.order >= count - 1
}

function canResizeWidget(instance: WidgetInstance, axis: 'columns' | 'rows', delta: number) {
  if (instance.stack)
    return false
  const probe = { ...instance, size: { ...instance.size } }
  return resizeInstanceWithinBounds(probe, axis, delta)
}

function resizeWidget(instance: WidgetInstance, axis: 'columns' | 'rows', delta: number) {
  if (resizeInstanceWithinBounds(instance, axis, delta))
    widgetLayoutDirty.value = true
}

function toggleWidgetHidden(instance: WidgetInstance) {
  instance.hidden = !instance.hidden
  widgetLayoutDirty.value = true
}

function removeWidgetInstance(index: number) {
  const instance = widgetInstances.value[index]
  if (instance)
    pendingWidgetStorageCleanup.add(instance.id)
  widgetInstances.value.splice(index, 1)
  normalizeWidgetStacks(widgetInstances.value)
  widgetInstances.value = [...widgetInstances.value]
  widgetLayoutDirty.value = true
}

function hasWidgetSettings(instance: WidgetInstance) {
  return Boolean(Object.keys(widgetRegistry.get(instance.type)?.configSchema.fields ?? {}).length)
}

function openWidgetSettings(instance: WidgetInstance) {
  widgetSettingsInstance.value = instance
  widgetSettingsVisible.value = true
}

function applyWidgetSettings(updated: WidgetInstance) {
  const index = widgetInstances.value.findIndex(instance => instance.id === updated.id)
  if (index >= 0) {
    widgetInstances.value[index] = updated
    widgetLayoutDirty.value = true
  }
}

function handleWidgetAdd(type: string | number) {
  try {
    const instance = widgetRegistry.create(String(type), generateWidgetInstanceId(String(type)), { column: 0, row: widgetInstances.value.length })
    widgetInstances.value.push(instance)
    widgetLayoutDirty.value = true
  }
  catch (error) {
    console.warn('Failed to create widget instance.', error)
  }
}

function enterWidgetLayoutEdit() {
  if (widgetLayoutLoadError.value) {
    ms.warning('当前布局来自更高版本，已阻止编辑以避免覆盖未知组件数据')
    return
  }
  widgetEditMode.value = true
  widgetLayoutDirty.value = false
}

function cancelWidgetLayoutEdit() {
  widgetInstances.value = buildWidgetInstances(panelState.panelConfig.widgets)
  widgetLayoutDirty.value = false
  widgetEditMode.value = false
  pendingWidgetStorageCleanup.clear()
}

async function saveWidgetLayout(closeEditor = true): Promise<boolean> {
  if (widgetLayoutSaving.value)
    return false
  widgetLayoutSaving.value = true
  try {
    const nextLayout = serializeWidgetLayout(widgetInstances.value, quarantinedWidgets.value)
    const nextPanelConfig = { ...panelState.panelConfig, widgets: nextLayout }
    const { code, msg, queued } = await enqueueAppearanceSave(() => setUserConfig({ panel: nextPanelConfig }))
    if (code === 0) {
      panelState.panelConfig = nextPanelConfig
      panelState.recordState()
      widgetLayoutDirty.value = false
      if (closeEditor)
        widgetEditMode.value = false
      // 离线排队时远端尚未确认删除，保留组件私有数据可避免冲突恢复后丢失。
      if (!queued)
        await Promise.all([...pendingWidgetStorageCleanup].map(id => clearWidgetStorage(id)))
      pendingWidgetStorageCleanup.clear()
      ms.success(t('widgetLayout.saveSuccess'))
      return true
    }
    ms.error(`${t('widgetLayout.saveFail')}:${msg}`)
    return false
  }
  catch (error) {
    ms.error(`${t('widgetLayout.saveFail')}:${error instanceof Error ? error.message : String(error)}`)
    return false
  }
  finally {
    widgetLayoutSaving.value = false
  }
}

const { activeWidgetId: resizingWidgetId, startWidgetResize } = useWidgetGridResize({
  onPreview: () => {
    widgetLayoutDirty.value = true
  },
  onCommit: () => {
    widgetLayoutDirty.value = true
  },
})

function startHomeWidgetResize(event: PointerEvent, instance: WidgetInstance, direction: 'columns' | 'rows' | 'both') {
  const grid = event.currentTarget instanceof HTMLElement
    ? event.currentTarget.closest<HTMLElement>('.widget-grid')
    : null
  startWidgetResize(event, instance, direction, grid)
}

let browseWidgetSnapshot: WidgetInstance[] | null = null
function handleBrowseWidgetDragStart() {
  browseWidgetSnapshot = widgetInstances.value.map(instance => ({
    ...instance,
    position: { ...instance.position },
    size: { ...instance.size },
  }))
}

async function handleBrowseWidgetDragEnd() {
  const snapshot = browseWidgetSnapshot
  browseWidgetSnapshot = null
  widgetInstances.value.forEach((instance, index) => {
    instance.position = { column: 0, row: index }
  })
  widgetLayoutDirty.value = true
  if (!await saveWidgetLayout(false) && snapshot) {
    widgetInstances.value = snapshot
    widgetLayoutDirty.value = false
  }
}

function handleWidgetEditDragEnd() {
  widgetInstances.value.forEach((instance, index) => {
    instance.position = { column: 0, row: index }
  })
  widgetLayoutDirty.value = true
}

function openPage(openMethod: number, url: string, title?: string) {
  switch (openMethod) {
    case 1:
      // CARD-06: 如果当前页面在 iframe 中，使用父窗口打开
      if (window.top !== null && window.top !== window.self) {
        // Same scheme check as runtime.openUrl: only http(s) targets.
        try {
          window.top!.location.href = runtime.resolveNavigationUrl(url)
        }
        catch {
          ms.error(t('common.invalidUrl'))
        }
      }
      else
        runtime.openUrl(url, 'current')
      break
    case 2:
      runtime.openUrl(url, 'tab')
      break
    case 3:
      try {
        windowSrc.value = runtime.resolveNavigationUrl(url)
        windowShow.value = true
        windowTitle.value = title || url
        windowIframeIsLoad.value = true
      }
      catch {
        ms.error(t('common.invalidUrl'))
      }
      break

    default:
      break
  }
}

async function handleItemClick(itemGroup: DashboardGroup, item: Panel.ItemInfo) {
  if (Date.now() < suppressBookmarkClickUntil)
    return
  if (itemGroup.sortStatus) {
    handleEditItem(item)
    return
  }
  const reservedTab = panelState.networkMode === PanelStateNetworkModeEnum.auto && item.lanUrl && item.openMethod === 2
    ? runtime.reserveTab?.() : null
  const jumpUrl = await resolveItemUrl(item, panelState.networkMode)
  if (reservedTab) { reservedTab.navigate(jumpUrl); return }
  openPage(item.openMethod, jumpUrl, item.title)
}

function canDragBookmarks(group: DashboardGroup) {
  return canEdit.value && group.items.length > 1 && !searchKeyword.value.trim()
}

function handleBookmarkDragStart(group: DashboardGroup) {
  bookmarkDragSnapshots.set(group, group.items.map(item => ({ ...item })))
  suppressBookmarkClickUntil = Date.now() + 800
}

async function handleBookmarkDragEnd(group: DashboardGroup) {
  suppressBookmarkClickUntil = Date.now() + 500
  const snapshot = bookmarkDragSnapshots.get(group)
  bookmarkDragSnapshots.delete(group)
  if (!snapshot)
    return
  group.items.forEach((item, index) => { item.sort = index + 1 })
  const request = createItemSortRequest(group)
  if (!request) {
    group.items = snapshot
    refreshFilteredItems()
    return
  }
  try {
    const response = await saveSort(request)
    if (response.code !== 0) {
      group.items = snapshot
      refreshFilteredItems()
      ms.error(`${t('common.saveFail')}:${response.msg}`)
    }
    else if (response.queued) {
      ms.info(response.msg)
    }
  }
  catch (error) {
    group.items = snapshot
    refreshFilteredItems()
    ms.error(`${t('common.saveFail')}:${error instanceof Error ? error.message : String(error)}`)
  }
}

function handWindowIframeIdLoad(_payload: Event) {
  windowIframeIsLoad.value = false
}

async function getList() {
  // CARD-05: 先读取本地缓存快速渲染，后台刷新
  const cached = persistentStorage.get<Panel.ItemIconGroup[]>('card-list-cache')
  if (cached) {
    items.value = normalizeDashboardGroups(cached)
    refreshFilteredItems()
    groupsLoaded.value = true
  }
  try {
    // 获取组数据
    const { code, data } = await getGroupList<Common.ListResponse<Panel.ItemIconGroup[]>>()
    if (code !== 0 || !data?.list) {
      groupsLoadFailed.value = true
      groupsLoaded.value = true
      return false
    }
    items.value = normalizeDashboardGroups(data.list)
    await Promise.all(items.value.map(async (element, index) => {
      if (element.id)
        await updateItemIconGroupByNet(index, element.id)
    }))
    persistentStorage.set('card-list-cache', items.value)
    refreshFilteredItems()
    groupsLoadFailed.value = false
    groupsLoaded.value = true
    return true
  }
  catch (error) {
    console.warn('Unable to refresh dashboard groups.', error)
    groupsLoadFailed.value = true
    groupsLoaded.value = true
    return false
  }
}

// 从后端获取组下面的图标
async function updateItemIconGroupByNet(itemIconGroupIndex: number, itemIconGroupId: number) {
  const res = await getListByGroupId<Common.ListResponse<Panel.ItemInfo[]>>(itemIconGroupId)
  if (res.code === 0 && items.value[itemIconGroupIndex]) {
    items.value[itemIconGroupIndex].items = res.data.list
    refreshFilteredItems()
  }
}

async function handleRightMenuSelect(key: string | number) {
  dropdownShow.value = false
  // console.log(currentRightSelectItem, key)
  switch (key) {
    case 'newWindows': {
      if (!currentRightSelectItem.value) break
      const tab = runtime.reserveTab?.()
      const url = await resolveItemUrl(currentRightSelectItem.value, panelState.networkMode)
      if (tab) tab.navigate(url)
      else runtime.openUrl(url, 'tab')
      break
    }
    case 'openWanUrl':
      if (currentRightSelectItem.value)
        openPage(currentRightSelectItem.value?.openMethod, currentRightSelectItem.value?.url, currentRightSelectItem.value?.title)
      break
    case 'openLanUrl':
      if (currentRightSelectItem.value && currentRightSelectItem.value.lanUrl)
        openPage(currentRightSelectItem.value?.openMethod, currentRightSelectItem.value.lanUrl, currentRightSelectItem.value?.title)
      break
    case 'edit':
      // 这里有个奇怪的问题，如果不使用{...}的方式 父组件的值会同步修改 标记一下
      handleEditItem({ ...currentRightSelectItem.value } as Panel.ItemInfo)
      break
    case 'delete':
      dialog.warning({
        title: t('common.warning'),
        content: t('common.deleteConfirmByName', { name: currentRightSelectItem.value?.title }),
        positiveText: t('common.confirm'),
        negativeText: t('common.cancel'),
        onPositiveClick: () => {
          deletes([currentRightSelectItem.value?.id as number]).then(({ code, msg }) => {
            if (code === 0) {
              ms.success(t('common.deleteSuccess'))
              getList()
            }
            else {
              ms.error(`${t('common.deleteFail')}:${msg}`)
            }
          })
        },
      })

      break
    default:
      break
  }
}

// CARD-03: 鼠标中键在新窗口打开卡片地址
async function handleAuxClick(e: MouseEvent, itemGroup: DashboardGroup, item: Panel.ItemInfo) {
  if (e.button === 1) {
    e.preventDefault()
    const reservedTab = runtime.reserveTab?.()
    const jumpUrl = await resolveItemUrl(item, panelState.networkMode)
    if (reservedTab) reservedTab.navigate(jumpUrl)
    else runtime.openUrl(jumpUrl, 'tab')
  }
}

function handleContextMenu(e: MouseEvent, itemGroup: DashboardGroup, item: Panel.ItemInfo) {
  if (itemGroup.sortStatus)
    return

  e.preventDefault()
  currentRightSelectItem.value = item
  dropdownShow.value = false
  nextTick().then(() => {
    dropdownShow.value = true
    dropdownMenuX.value = e.clientX
    dropdownMenuY.value = e.clientY
  })
}

function onClickoutside() {
  // message.info('clickoutside')
  dropdownShow.value = false
}

function handleEditSuccess(_item: Panel.ItemInfo, _meta?: { queued: boolean }) {
  getList()
}

function handleChangeNetwork(mode: PanelStateNetworkModeEnum) {
  panelState.setNetworkMode(mode)
  if (mode === PanelStateNetworkModeEnum.lan)
    ms.success(t('panelHome.changeToLanModelSuccess'))

  else
    ms.success(t('panelHome.changeToWanModelSuccess'))
}

// 结束拖拽
// function handleEndDrag(event: any, itemIconGroup: Panel.ItemIconGroup) {
//   // console.log(event)
//   // console.log(items.value)
// }

function handleSaveSort(itemGroup: DashboardGroup) {
  const request = createItemSortRequest(itemGroup)
  if (request) {
    saveSort(request).then(({ code, msg }) => {
      if (code === 0) {
        ms.success(t('common.saveSuccess'))
        itemGroup.sortStatus = false
      }
      else {
        ms.error(`${t('common.saveFail')}:${msg}`)
      }
    })
  }
}

function getDropdownMenuOptions() {
  const dropdownMenuOptions = [
    {
      label: t('iconItem.newWindowOpen'),
      key: 'newWindows',
      icon: () => h(ThemeIcon, { name: 'externalLink' }),
    },

  ]

  // CARD-09: 展示所有已填写地址
  if (currentRightSelectItem.value?.url) {
    dropdownMenuOptions.push({
      label: t('panelHome.openWanUrl'),
      key: 'openWanUrl',
      icon: () => h(ThemeIcon, { name: 'externalLink' }),
    })
  }

  if (currentRightSelectItem.value?.lanUrl) {
    dropdownMenuOptions.push({
      label: t('panelHome.openLanUrl'),
      key: 'openLanUrl',
      icon: () => h(ThemeIcon, { name: 'networkWired' }),
    })
  }

  if (canEdit.value) {
    dropdownMenuOptions.push({
      label: t('common.edit'),
      key: 'edit',
      icon: () => h(ThemeIcon, { name: 'edit' }),
    }, {
      label: t('common.delete'),
      key: 'delete',
      icon: () => h(ThemeIcon, { name: 'delete' }),
    })
  }

  return dropdownMenuOptions
}

function applyBootstrapData(data: Sync.BootstrapResponseV1) {
  const dashboard = createDashboardState(data)
  setSyncRevision(dashboard.revision)
  webSyncRevision = dashboard.revision
  authStore.setUserInfo(dashboard.account)
  panelState.applyPanelConfig(receiveSharedSettings(dashboard.panelConfig, dashboard.account.id, dashboard.revision))
  authStore.setVisitMode(VisitMode.VISIT_MODE_LOGIN)
  userStore.updateUserInfo(dashboard.account)
  items.value = dashboard.groups
  groupsLoaded.value = true
  groupsLoadFailed.value = false
  refreshFilteredItems()
  if (panelState.panelConfig.logoText)
    setTitle(panelState.panelConfig.logoText)
}

async function refreshWebBootstrap() {
  if (runtime.kind !== 'web' || authStore.authMode !== 'device' || !authStore.token)
    return
  if (webBootstrapRefreshPromise)
    return webBootstrapRefreshPromise
  const accountId = authStore.userInfo?.id
  webBootstrapRefreshPromise = (async () => {
    const response = await getBootstrap()
    if (!isDisposed && !webEditInProgress() && response.code === 0 && response.data && authStore.userInfo?.id === accountId)
      applyBootstrapData(response.data)
  })()
  try {
    await webBootstrapRefreshPromise
  }
  finally {
    webBootstrapRefreshPromise = null
  }
}

function webEditInProgress() {
  return editItemInfoShow.value || settingModalShow.value || themeCenterVisible.value
    || widgetEditMode.value || widgetLayoutSaving.value
}

/** Web and extension listen to the same account revision, but each keeps its
 * own appearance/layout boundary. A hidden page closes its held request. */
async function startWebSyncWatch() {
  if (runtime.kind !== 'web' || webSyncWatchRunning || isDisposed || document.hidden
    || authStore.authMode !== 'device' || !authStore.token || !authStore.userInfo?.id)
    return
  webSyncWatchRunning = true
  try {
    while (true) {
      if (isDisposed || document.hidden || authStore.authMode !== 'device' || !authStore.token || !authStore.userInfo?.id)
        break
      if (webEditInProgress()) {
        await new Promise(resolve => window.setTimeout(resolve, 1000))
        continue
      }
      const accountId: number = authStore.userInfo.id
      const controller = new AbortController()
      webSyncWatchController = controller
      try {
        const response = await waitForSyncChange(webSyncRevision, controller.signal)
        if (controller.signal.aborted || isDisposed || authStore.userInfo?.id !== accountId)
          break
        if (response.code !== 0) {
          await new Promise(resolve => window.setTimeout(resolve, 10_000))
          await refreshWebBootstrap()
          continue
        }
        if (response.data?.changed && response.data.revision !== webSyncRevision) {
          if (webEditInProgress())
            continue
          await refreshWebBootstrap()
          if (response.data.revision !== webSyncRevision)
            await new Promise(resolve => window.setTimeout(resolve, 750))
        }
      }
      catch {
        if (controller.signal.aborted || isDisposed || document.hidden)
          break
        await new Promise(resolve => window.setTimeout(resolve, 10_000))
        await refreshWebBootstrap()
      }
      finally {
        if (webSyncWatchController === controller)
          webSyncWatchController = null
      }
    }
  }
  finally {
    webSyncWatchRunning = false
    if (!isDisposed && !document.hidden && authStore.authMode === 'device' && authStore.token)
      void startWebSyncWatch()
  }
}

function handleWebVisibilityChange() {
  if (runtime.kind !== 'web')
    return
  if (document.hidden)
    webSyncWatchController?.abort()
  else
    void refreshWebBootstrap().then(startWebSyncWatch, startWebSyncWatch)
}

async function refreshExtensionBootstrap() {
  const accountId = authStore.userInfo?.id
  if (runtime.kind !== 'extension' || !accountId)
    return
  if (extensionRefreshPromise)
    return extensionRefreshPromise

  extensionSyncStatus.value = 'syncing'
  extensionRefreshPromise = (async () => {
    const result = await refreshBootstrapSnapshot(accountId)
    if (result.data && result.savedAt) {
      applyBootstrapData(result.data)
      hasCachedSnapshot = true
      lastSyncAt.value = result.savedAt
      extensionSyncStatus.value = 'online'
      return
    }
    extensionSyncStatus.value = hasCachedSnapshot ? 'offline' : 'error'
  })()
  try {
    await extensionRefreshPromise
  }
  finally {
    extensionRefreshPromise = null
  }
}

function handleBrowserOnline() {
  browserOnline.value = true
  void triggerOfflineReplay()
  if (runtime.kind === 'extension')
    void refreshExtensionBootstrap()
  else
    void refreshWebBootstrap().then(startWebSyncWatch, startWebSyncWatch)
}

function handleBrowserOffline() {
  browserOnline.value = false
  if (runtime.kind === 'extension')
    extensionSyncStatus.value = hasCachedSnapshot ? 'offline' : 'error'
}

async function handleSyncConflict() {
  if (runtime.kind === 'extension') {
    await refreshExtensionBootstrap()
    return
  }
  if (authStore.authMode !== 'device')
    return
  const bootstrap = await getBootstrap()
  if (bootstrap.code === 0)
    applyBootstrapData(bootstrap.data)
}

if (runtime.kind === 'extension') {
  panelState.resetPanelConfig()
  const accountId = authStore.userInfo?.id
  const cached = accountId ? readBootstrapSnapshot(accountId) : null
  if (cached) {
    applyBootstrapData(cached.data)
    hasCachedSnapshot = true
    lastSyncAt.value = cached.savedAt
    extensionSyncStatus.value = navigator.onLine ? 'cached' : 'offline'
  }
  else if (!navigator.onLine) {
    extensionSyncStatus.value = 'error'
  }
}

onMounted(async () => {
  isDisposed = false
  // Theme SDK 统一外观入口：结构性校验 + 剥离非法主题 + 补默认选择（含旧字段迁移）。
  // 由 store.applyPanelConfig 内部统一跑一次 preparePanelAppearance；扩展端在清理后回写
  // EXTENSION_APPEARANCE_KEY（字节去重，未变化不写）。
  panelState.applyPanelConfig(panelState.panelConfig, {
    mode: appStore.theme,
    writeBack: runtime.kind === 'extension',
  })

  removeSyncConflictListener = onSyncConflict(handleSyncConflict)
  window.addEventListener('online', handleBrowserOnline)
  window.addEventListener('offline', handleBrowserOffline)
  document.addEventListener('visibilitychange', handleWebVisibilityChange)
  if (runtime.kind === 'extension') {
    void refreshExtensionBootstrap()
    return
  }

  // 更新用户信息
  try {
    await updateLocalUserInfo()
  }
  catch (error) {
    console.warn('Unable to refresh account information.', error)
  }

  if (authStore.visitMode === VisitMode.VISIT_MODE_LOGIN && authStore.authMode === 'device') {
    try {
      const bootstrap = await getBootstrap()
      if (bootstrap.code === 0 && bootstrap.data) {
        applyBootstrapData(bootstrap.data)
        void startWebSyncWatch()
        return
      }
    }
    catch (error) {
      console.warn('Unable to load dashboard snapshot.', error)
    }
  }

  // 分组、卡片和面板配置来自同一个已验证会话，可以并行加载。
  await Promise.allSettled([getList(), panelState.updatePanelConfigByCloud()])

  // 设置标题
  if (panelState.panelConfig.logoText)
    setTitle(panelState.panelConfig.logoText)
  void startWebSyncWatch()
})

onUnmounted(() => {
  isDisposed = true
  webSyncWatchController?.abort()
  removeSyncConflictListener?.()
  window.removeEventListener('online', handleBrowserOnline)
  window.removeEventListener('offline', handleBrowserOffline)
  document.removeEventListener('visibilitychange', handleWebVisibilityChange)
})

// 前端搜索过滤
function itemFrontEndSearch(keyword?: string) {
  searchKeyword.value = keyword ?? ''
  refreshFilteredItems()
}

function refreshFilteredItems() {
  filterItems.value = filterDashboardGroups(items.value, searchKeyword.value, Boolean(panelState.panelConfig.searchBoxSearchIcon))
}

function handleSetHoverStatus(group: DashboardGroup, hoverStatus: boolean) {
  group.hoverStatus = hoverStatus
}

function handleSetSortStatus(group: DashboardGroup, sortStatus: boolean) {
  const source = items.value.find(item => item.id === group.id)
  if (!source)
    return
  source.sortStatus = sortStatus
  group.sortStatus = sortStatus

  if (!sortStatus) {
    const sourceIndex = items.value.indexOf(source)
    if (source.id)
      updateItemIconGroupByNet(sourceIndex, source.id)
  }
}

function handleEditItem(item: Panel.ItemInfo) {
  editItemInfoData.value = item
  editItemInfoShow.value = true
  currentAddItenIconGroupId.value = undefined
}

function handleAddItem(itemIconGroupId?: number) {
  iconGalleryGroupId.value = itemIconGroupId ?? items.value[0]?.id ?? null
  iconGalleryVisible.value = true
}

function addCatalogWidget(type: string) {
  if (!canEdit.value || widgetLayoutLoadError.value)
    return
  if (!widgetEditMode.value)
    enterWidgetLayoutEdit()
  handleWidgetAdd(type)
  iconGalleryVisible.value = false
}
</script>

<template>
  <div class="w-full h-full sun-main" :class="{ 'extension-home': layout === 'extension', 'web-home': layout === 'web', 'has-wallpaper': Boolean(activeWallpaper) }">
    <div
      class="cover wallpaper" :style="{
        filter: `blur(${panelState.panelConfig.backgroundBlur}px)`,
        background: activeWallpaper ? `url(${JSON.stringify(activeWallpaper)}) no-repeat` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }"
    />
    <div class="mask" :style="{ backgroundColor: `rgba(0,0,0,${panelState.panelConfig.backgroundMaskNumber})` }" />
    <div class="runtime-status-bar" role="status" :aria-label="t('panelHome.statusOverview')">
      <span class="status-chip">{{ runtimeLabel }}</span>
      <span class="status-chip" :class="browserOnline ? 'status-online' : 'status-offline'">
        <span class="status-dot" />{{ networkLabel }}
      </span>
      <button
        v-if="layout === 'extension'"
        type="button"
        class="status-chip sync-indicator"
        :class="`sync-${extensionSyncStatus}`"
        :title="extensionSyncTitle"
        :disabled="extensionSyncStatus === 'syncing'"
        @click="refreshExtensionBootstrap"
      >
        <span class="sync-dot" />{{ extensionSyncLabel }}
      </button>
      <button
        v-if="pendingMutationsCount > 0"
        type="button"
        class="status-chip bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 cursor-pointer"
        title="点击立即重放离线修改"
        @click="triggerOfflineReplay"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        {{ pendingMutationsCount }} 条待同步
      </button>
      <span class="status-chip" :title="sessionTitle">{{ sessionLabel }}</span>
    </div>
    <div ref="scrollContainerRef" class="absolute w-full h-full overflow-auto flex flex-col justify-between">
      <div
        class="home-content p-2.5 mx-auto w-full flex-1 flex flex-col"
        :style="{
          marginTop: layout === 'extension' ? '0' : `${panelState.panelConfig.marginTop}%`,
          maxWidth: layout === 'extension' ? '1440px' : (panelState.panelConfig.maxWidth ?? '1200') + panelState.panelConfig.maxWidthUnit,
        }"
      >
        <!-- 头 -->
        <div class="home-header mx-[auto] w-[80%]">
          <div class="home-identity flex mx-[auto] items-center justify-center text-white">
            <div v-if="panelState.panelConfig.logoShow" class="logo">
              <span class="text-2xl md:text-6xl font-bold text-shadow">
                {{ panelState.panelConfig.logoText }}
              </span>
            </div>
            <div v-if="panelState.panelConfig.logoShow && panelState.panelConfig.clockShow" class="divider text-base lg:text-2xl mx-[10px]">
              |
            </div>
            <div v-if="panelState.panelConfig.clockShow" class="text-shadow">
              <WidgetHost :instance="headerClockWidget" />
            </div>
            <div class="header-weather">
              <WidgetHost :instance="headerWeatherWidget" />
            </div>
          </div>
          <div v-if="panelState.panelConfig.searchBoxShow" class="home-search flex mt-[20px] mx-auto sm:w-full lg:w-[80%]">
            <WidgetHost :instance="headerSearchWidget" @item-search="itemFrontEndSearch" />
          </div>
        </div>

        <!-- 小组件区域（宽度与下方收藏区完全保持一致） -->
        <div
          class="home-widgets w-full mx-auto mt-[24px]"
          :style="layout === 'extension'
            ? undefined
            : { marginLeft: `${panelState.panelConfig.marginX}px`, marginRight: `${panelState.panelConfig.marginX}px` }"
        >
          <div v-if="canEdit" class="widget-toolbar">
            <button v-if="!widgetEditMode" type="button" class="widget-tool-button" @click="enterWidgetLayoutEdit">
              {{ t('widgetLayout.edit') }}
            </button>
            <template v-else>
              <NDropdown trigger="click" :options="widgetAddOptions" @select="handleWidgetAdd">
                <button type="button" class="widget-tool-button">
                  {{ t('widgetLayout.add') }}
                </button>
              </NDropdown>
              <button type="button" class="widget-tool-button" :disabled="widgetLayoutSaving" @click="saveWidgetLayout()">
                {{ t('widgetLayout.save') }}
              </button>
              <button type="button" class="widget-tool-button" @click="cancelWidgetLayoutEdit">
                {{ t('widgetLayout.cancel') }}
              </button>
            </template>
          </div>

          <!-- 浏览模式 -->
          <VueDraggable
            v-if="!widgetEditMode"
            v-model="visibleWidgetGroups"
            item-key="key"
            class="widget-grid"
            :disabled="!canEdit || widgetLayoutSaving || visibleWidgetGroups.length < 2"
            :delay="480"
            :delay-on-touch-only="false"
            :touch-start-threshold="8"
            :fallback-tolerance="8"
            filter="input, textarea, button, a, select, [contenteditable='true'], [data-no-drag]"
            :prevent-on-filter="false"
            chosen-class="is-long-press-dragging"
            :animation="180"
            @start="handleBrowseWidgetDragStart"
            @end="handleBrowseWidgetDragEnd"
          >
            <div
              v-for="group in visibleWidgetGroups" :key="group.key"
              class="widget-cell" :style="widgetCellStyle(group)"
            >
              <WidgetStackHost :instances="group.members" @item-search="itemFrontEndSearch" />
            </div>
          </VueDraggable>

          <!-- 编辑模式：拖放排序、缩放、隐藏与删除 -->
          <VueDraggable
            v-else
            v-model="widgetInstances" item-key="id" :animation="200"
            handle=".widget-edit-handle"
            :disabled="Boolean(resizingWidgetId)"
            class="widget-grid widget-grid-editing"
            @end="handleWidgetEditDragEnd"
          >
            <div
              v-for="(instance, index) in widgetInstances" :key="instance.id"
              class="widget-cell"
              :class="{ 'is-resizing': resizingWidgetId === instance.id }"
              :style="widgetCellStyle(instance)"
            >
              <div v-if="instance.hidden" class="widget-hidden-card">
                <span v-if="!instance.stack" class="widget-edit-handle" :title="t('widgetLayout.drag')">{{ '⠿' }}</span>
                <span v-else class="widget-stack-member-badge">{{ `${t('widgetLayout.stack.title')} ${instance.stack.order + 1}` }}</span>
                <span class="widget-hidden-name">{{ widgetTypeLabel(instance.type) }}</span>
                <button type="button" class="widget-edit-action" :title="t('widgetLayout.show')" @click="toggleWidgetHidden(instance)">
                  {{ '👁' }}
                </button>
                <button v-if="instance.stack" type="button" class="widget-edit-action" :title="t('widgetLayout.stack.remove')" @click="removeWidgetFromStack(instance)">
                  {{ '□' }}
                </button>
                <button type="button" class="widget-edit-action" :title="t('widgetLayout.remove')" @click="removeWidgetInstance(index)">
                  {{ '✕' }}
                </button>
              </div>
              <div v-else class="widget-edit-card">
                <div class="widget-edit-bar">
                  <span v-if="!instance.stack" class="widget-edit-handle" :title="t('widgetLayout.drag')">{{ '⠿' }}</span>
                  <span v-else class="widget-stack-member-badge">{{ `${t('widgetLayout.stack.title')} ${instance.stack.order + 1}` }}</span>
                  <button type="button" class="widget-edit-action" :title="t('widgetLayout.narrow')" :disabled="!canResizeWidget(instance, 'columns', -1)" @click="resizeWidget(instance, 'columns', -1)">
                    {{ '−' }}
                  </button>
                  <button type="button" class="widget-edit-action" :title="t('widgetLayout.widen')" :disabled="!canResizeWidget(instance, 'columns', 1)" @click="resizeWidget(instance, 'columns', 1)">
                    {{ '＋' }}
                  </button>
                  <button type="button" class="widget-edit-action" :title="t('widgetLayout.shrink')" :disabled="!canResizeWidget(instance, 'rows', -1)" @click="resizeWidget(instance, 'rows', -1)">
                    {{ '⌃' }}
                  </button>
                  <button type="button" class="widget-edit-action" :title="t('widgetLayout.stretch')" :disabled="!canResizeWidget(instance, 'rows', 1)" @click="resizeWidget(instance, 'rows', 1)">
                    {{ '⌄' }}
                  </button>
                  <button type="button" class="widget-edit-action" :title="t('widgetLayout.hide')" @click="toggleWidgetHidden(instance)">
                    {{ '🚫' }}
                  </button>
                  <button v-if="hasWidgetSettings(instance)" type="button" class="widget-edit-action" title="配置" @click="openWidgetSettings(instance)">
                    {{ '⚙' }}
                  </button>
                  <NDropdown
                    v-if="!instance.stack && widgetStackTargetOptions(instance).length"
                    trigger="click"
                    :options="widgetStackTargetOptions(instance)"
                    @select="stackWidgetWith(instance, $event)"
                  >
                    <button type="button" class="widget-edit-action" :title="t('widgetLayout.stack.add')">
                      {{ '▣' }}
                    </button>
                  </NDropdown>
                  <button v-if="instance.stack" type="button" class="widget-edit-action" :title="t('widgetLayout.stack.moveUp')" :disabled="instance.stack.order === 0" @click="moveStackMember(instance, -1)">
                    {{ '⇧' }}
                  </button>
                  <button v-if="instance.stack" type="button" class="widget-edit-action" :title="t('widgetLayout.stack.moveDown')" :disabled="isLastWidgetStackMember(instance)" @click="moveStackMember(instance, 1)">
                    {{ '⇩' }}
                  </button>
                  <button v-if="instance.stack" type="button" class="widget-edit-action" :title="t('widgetLayout.stack.remove')" @click="removeWidgetFromStack(instance)">
                    {{ '□' }}
                  </button>
                  <button type="button" class="widget-edit-action" :title="t('widgetLayout.remove')" @click="removeWidgetInstance(index)">
                    {{ '✕' }}
                  </button>
                </div>
                <WidgetHost :instance="instance" :edit-mode="true" @item-search="itemFrontEndSearch" />
                <button
                  v-if="!instance.stack"
                  type="button"
                  class="widget-resize-handle is-right"
                  data-no-drag
                  :aria-label="t('widgetLayout.widen')"
                  @pointerdown="startHomeWidgetResize($event, instance, 'columns')"
                />
                <button
                  v-if="!instance.stack"
                  type="button"
                  class="widget-resize-handle is-bottom"
                  data-no-drag
                  :aria-label="t('widgetLayout.stretch')"
                  @pointerdown="startHomeWidgetResize($event, instance, 'rows')"
                />
                <button
                  v-if="!instance.stack"
                  type="button"
                  class="widget-resize-handle is-corner"
                  data-no-drag
                  :aria-label="`${t('widgetLayout.widen')} / ${t('widgetLayout.stretch')}`"
                  @pointerdown="startHomeWidgetResize($event, instance, 'both')"
                />
              </div>
            </div>
          </VueDraggable>
        </div>

        <!-- 应用盒子 -->
        <div
          class="home-groups"
          :style="layout === 'extension'
            ? undefined
            : { marginLeft: `${panelState.panelConfig.marginX}px`, marginRight: `${panelState.panelConfig.marginX}px` }"
        >
          <div v-if="groupsLoaded && filterItems.length === 0" class="home-groups-empty" role="status">
            <span class="home-groups-empty-icon" aria-hidden="true"><ThemeIcon name="dashboard" /></span>
            <strong>{{ searchKeyword.trim() ? $t('panelHome.noSearchResults') : groupsLoadFailed ? $t('panelHome.groupsUnavailable') : $t('panelHome.noGroups') }}</strong>
            <p>{{ searchKeyword.trim() ? $t('panelHome.noSearchResultsHint') : groupsLoadFailed ? $t('panelHome.groupsUnavailableHint') : $t('panelHome.noGroupsHint') }}</p>
            <NButton v-if="searchKeyword.trim()" secondary @click="itemFrontEndSearch('')">
              {{ $t('panelHome.clearSearch') }}
            </NButton>
            <NButton v-else-if="groupsLoadFailed" secondary @click="getList">
              {{ $t('panelHome.retryGroups') }}
            </NButton>
            <NButton v-else-if="canEdit" secondary @click="settingModalShow = true">
              {{ $t('panelHome.openControlCenter') }}
            </NButton>
          </div>
          <!-- 系统监控状态 -->
          <div
            v-if="panelState.panelConfig.systemMonitorShow
              && ((panelState.panelConfig.systemMonitorPublicVisitModeShow && authStore.visitMode === VisitMode.VISIT_MODE_PUBLIC)
                || authStore.visitMode === VisitMode.VISIT_MODE_LOGIN)"
            class="flex mx-auto"
          >
            <SystemMonitor
              :allow-edit="canEdit"
              :show-title="panelState.panelConfig.systemMonitorShowTitle"
            />
          </div>

          <!-- 组纵向排列 -->
          <div
            v-for="(itemGroup, itemGroupIndex) in filterItems" :key="itemGroupIndex"
            class="item-list mt-[50px]"
            :class="[itemGroup.sortStatus ? 'shadow-2xl border shadow-[0_0_30px_10px_rgba(0,0,0,0.3)]  p-[10px] rounded-2xl' : '', `group-${itemGroup.id}`]"
            @mouseenter="handleSetHoverStatus(itemGroup, true)"
            @mouseleave="handleSetHoverStatus(itemGroup, false)"
          >
            <!-- 分组标题 -->
            <div class="text-white text-xl font-extrabold mb-[20px] ml-[10px] flex items-center">
              <span class="group-title text-shadow">
                {{ itemGroup.title }}
              </span>
              <div
                v-if="canEdit"
                class="group-buttons ml-2 delay-100 transition-opacity flex"
                :class="itemGroup.hoverStatus ? 'opacity-100' : 'opacity-0'"
              >
                <button type="button" class="group-action" :title="t('common.sort')" :aria-label="t('common.sort')" @click="handleSetSortStatus(itemGroup, !itemGroup.sortStatus)">
                  <span class="text-white font-xl"><ThemeIcon name="drag" /></span>
                </button>
              </div>
            </div>

            <!-- 详情图标 -->
            <div v-if="panelState.panelConfig.iconStyle === PanelPanelConfigStyleEnum.info">
              <div v-if="itemGroup.items">
                <VueDraggable
                  v-model="itemGroup.items" item-key="id" :animation="300"
                  class="icon-info-box"
                  filter=".not-drag"
                  :disabled="!canDragBookmarks(itemGroup)"
                  :delay="itemGroup.sortStatus ? 0 : 480"
                  :delay-on-touch-only="false"
                  :touch-start-threshold="8"
                  :fallback-tolerance="8"
                  :prevent-on-filter="false"
                  chosen-class="is-bookmark-long-pressing"
                  @start="handleBookmarkDragStart(itemGroup)"
                  @end="handleBookmarkDragEnd(itemGroup)"
                >
                  <div v-for="item in itemGroup.items" :key="item.id" :title="item.description" @contextmenu="(e) => handleContextMenu(e, itemGroup, item)" @auxclick="(e) => handleAuxClick(e, itemGroup, item)">
                    <AppIcon
                      :class="canDragBookmarks(itemGroup) ? 'cursor-grab' : 'cursor-pointer'"
                      :item-info="item"
                      :icon-text-color="homeIconTextColor"
                      :icon-text-info-hide-description="panelState.panelConfig.iconTextInfoHideDescription || false"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :style="0"
                      @click="handleItemClick(itemGroup, item)"
                    />
                  </div>

                  <div v-if="canEdit" class="not-drag">
                    <AppIcon
                      :class="canDragBookmarks(itemGroup) ? 'cursor-grab' : 'cursor-pointer'"
                      :item-info="{ icon: { itemType: 3, text: 'subway:add' }, title: t('common.add'), url: '', openMethod: 0 }"
                      :icon-text-color="homeIconTextColor"
                      :icon-text-info-hide-description="panelState.panelConfig.iconTextInfoHideDescription || false"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :style="0"
                      @click="handleAddItem(itemGroup.id)"
                    />
                  </div>
                </VueDraggable>
              </div>
            </div>

            <!-- APP图标宫型盒子 -->
            <div v-if="panelState.panelConfig.iconStyle === PanelPanelConfigStyleEnum.icon">
              <div v-if="itemGroup.items">
                <VueDraggable
                  v-model="itemGroup.items" item-key="id" :animation="300"
                  class="icon-small-box"

                  filter=".not-drag"
                  :disabled="!canDragBookmarks(itemGroup)"
                  :delay="itemGroup.sortStatus ? 0 : 480"
                  :delay-on-touch-only="false"
                  :touch-start-threshold="8"
                  :fallback-tolerance="8"
                  :prevent-on-filter="false"
                  chosen-class="is-bookmark-long-pressing"
                  @start="handleBookmarkDragStart(itemGroup)"
                  @end="handleBookmarkDragEnd(itemGroup)"
                >
                  <div v-for="item in itemGroup.items" :key="item.id" :title="item.description" @contextmenu="(e) => handleContextMenu(e, itemGroup, item)" @auxclick="(e) => handleAuxClick(e, itemGroup, item)">
                    <AppIcon
                      :class="canDragBookmarks(itemGroup) ? 'cursor-grab' : 'cursor-pointer'"
                      :item-info="item"
                      :icon-text-color="homeIconTextColor"
                      :icon-text-info-hide-description="!panelState.panelConfig.iconTextInfoHideDescription"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :style="1"
                      @click="handleItemClick(itemGroup, item)"
                    />
                  </div>

                  <div v-if="canEdit" class="not-drag">
                    <button type="button" class="web-add-icon" @click="handleAddItem(itemGroup.id)">
                      <span><ThemeIcon name="add" /></span><small>{{ t('iconGallery.title') }}</small>
                    </button>
                  </div>
                </VueDraggable>
              </div>
            </div>

            <!-- 编辑栏 -->
            <div v-if="itemGroup.sortStatus" class="flex mt-[10px]">
              <div>
                <NButton color="#2a2a2a6b" @click="handleSaveSort(itemGroup)">
                  <template #icon>
                    <span class="text-white font-xl"><ThemeIcon name="save" /></span>
                  </template>
                  <div>
                    {{ $t('common.saveSort') }}
                  </div>
                </NButton>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- 页面底栏 (全局居中) -->
      <footer
        class="home-footer w-full flex items-center justify-center text-center py-6 px-4 select-none z-10"
        :style="{
          marginBottom: `${panelState.panelConfig.marginBottom}%`,
        }"
      >
        <div class="footer-inner flex items-center justify-center text-center" v-html="safeFooterHtml" />
      </footer>
    </div>

    <!-- 右键菜单 -->
    <NDropdown
      placement="bottom-start" trigger="manual" :x="dropdownMenuX" :y="dropdownMenuY"
      :options="getDropdownMenuOptions()" :show="dropdownShow" :on-clickoutside="onClickoutside" @select="handleRightMenuSelect"
    />

    <!-- 悬浮按钮 -->
    <div class="fixed-element shadow-[0_0_10px_2px_rgba(0,0,0,0.2)]">
      <NButtonGroup vertical>
        <!-- 网络模式切换按钮组 -->
        <NButton
          v-if="panelState.networkMode === PanelStateNetworkModeEnum.lan && panelState.panelConfig.netModeChangeButtonShow" color="#2a2a2a6b"
          :title="t('panelHome.changeToWanModel')" @click="handleChangeNetwork(PanelStateNetworkModeEnum.wan)"
        >
          <template #icon>
            <span class="text-white font-xl"><ThemeIcon name="networkWired" /></span>
          </template>
        </NButton>

        <NButton
          v-if="panelState.networkMode === PanelStateNetworkModeEnum.wan && panelState.panelConfig.netModeChangeButtonShow" color="#2a2a2a6b"
          :title="t('panelHome.changeToLanModel')" @click="handleChangeNetwork(PanelStateNetworkModeEnum.lan)"
        >
          <template #icon>
            <span class="text-white font-xl"><ThemeIcon name="networkWireless" /></span>
          </template>
        </NButton>

        <NButton v-if="canEdit" color="#2a2a2a6b" :title="t('appLauncher.title')" @click="settingModalShow = !settingModalShow">
          <template #icon>
            <span class="text-white font-xl"><ThemeIcon name="dashboard" /></span>
          </template>
        </NButton>

        <NButton v-if="canEdit" color="#2a2a2a6b" :title="t('theme.entry')" @click="themeCenterVisible = true">
          <template #icon>
            <span class="text-white font-xl"><ThemeIcon name="theme" /></span>
          </template>
        </NButton>

        <NButton v-if="authStore.visitMode === VisitMode.VISIT_MODE_PUBLIC" color="#2a2a2a6b" :title="$t('panelHome.goToLogin')" @click="loginVisible = true">
          <template #icon>
            <span class="text-white font-xl"><ThemeIcon name="user" /></span>
          </template>
        </NButton>
      </NButtonGroup>

      <AppStarter v-if="settingModalShow" v-model:visible="settingModalShow" />
      <!-- <Setting v-model:visible="settingModalShow" /> -->
    </div>

    <NBackTop
      :listen-to="() => scrollContainerRef!"
      :right="10"
      :bottom="10"
      style="background-color:transparent;border: none;box-shadow: none;"
    >
      <div class="shadow-[0_0_10px_2px_rgba(0,0,0,0.2)]">
        <NButton color="#2a2a2a6b">
          <template #icon>
            <span class="text-white font-xl"><ThemeIcon name="toTop" /></span>
          </template>
        </NButton>
      </div>
    </NBackTop>

    <EditItem v-if="editItemInfoShow" v-model:visible="editItemInfoShow" :item-info="editItemInfoData" :item-group-id="currentAddItenIconGroupId" @done="handleEditSuccess" />
    <IconGalleryModal
      v-if="iconGalleryVisible" v-model:show="iconGalleryVisible" v-model:page-id="iconGalleryGroupId"
      :pages="catalogPages" :can-add="canEdit"
      :added-counts="Object.fromEntries(widgetInstances.map(widget => [widget.type, widgetInstances.filter(item => item.type === widget.type).length]))"
      :busy="widgetLayoutSaving" @done="handleEditSuccess" @add-widget="addCatalogWidget" @login="loginVisible = true"
    />
    <NModal v-model:show="loginVisible" to=".pn-theme-root" preset="card" class="web-login-modal" :closable="!loginBusy" :mask-closable="!loginBusy" :close-on-esc="!loginBusy" style="width: min(460px, calc(100vw - 24px)); border-radius: 24px;" content-style="padding: 0;">
      <LoginForm v-if="loginVisible" embedded @busy="loginBusy = $event" @close="loginVisible = false" @authenticated="loginVisible = false; router.go(0)" />
    </NModal>
    <WidgetSettingsModal v-model:show="widgetSettingsVisible" :instance="widgetSettingsInstance" @save="applyWidgetSettings" />
    <ThemeSettingsModal
      :show="themeCenterVisible"
      :surface="runtime.kind"
      :current-selection="panelState.panelConfig.theme ?? null"
      @update:show="(value: boolean) => themeCenterVisible = value"
      @saved="(selection) => panelState.panelConfig = { ...panelState.panelConfig, theme: selection }"
    />

    <!-- 弹窗 -->
    <NModal
      v-model:show="windowShow" :mask-closable="false" preset="card"
      style="max-width: 1000px;height: 600px;border-radius: 1rem;" :bordered="true" size="small" role="dialog"
      aria-modal="true"
    >
      <template #header>
        <div class="flex items-center">
          <span class="mr-[20px]">
            {{ windowTitle }}
          </span>

          <NSpin v-if="windowIframeIsLoad" size="small" />
        </div>
      </template>
      <div class="w-full h-full rounded-2xl overflow-hidden border dark:border-zinc-700">
        <div v-if="windowIframeIsLoad" class="flex flex-col p-5">
          <NSkeleton height="50px" width="100%" class="rounded-lg" />
          <NSkeleton height="180px" width="100%" class="mt-[20px] rounded-lg" />
          <NSkeleton height="180px" width="100%" class="mt-[20px] rounded-lg" />
        </div>
        <iframe
          v-show="!windowIframeIsLoad" id="windowIframeId" :src="windowSrc"
          class="w-full h-full" frameborder="0" @load="handWindowIframeIdLoad"
        />
      </div>
    </NModal>

    <!-- 离线冲突解决弹窗 -->
    <ConflictResolverModal
      v-model:show="conflictModalVisible"
      :conflict="currentConflict"
      @resolve="onResolveConflict"
    />
  </div>
</template>

<style>
body,
html {
  overflow: hidden;
  background-color: rgb(54, 54, 54);
}
</style>

<style scoped>
.web-home { height: 100dvh; background: var(--pn-color-page-background); }
.web-home .home-widgets, .web-home .home-groups { width: auto; max-width: 100%; }
.web-home:not(.has-wallpaper) :is(.home-identity, .group-title, .group-action, .web-add-icon small) { color: var(--pn-color-text-primary); text-shadow: none; }
.web-home:not(.has-wallpaper) .home-identity :deep(.clock), .web-home:not(.has-wallpaper) .group-action :deep(svg) { color: var(--pn-color-text-primary); }
.web-home .home-content { padding: 24px 28px 32px; }
.web-home .home-header { width: 100%; max-width: 720px; }
.web-home .home-identity { position: relative; flex-direction: column; gap: 18px; }
.web-home .home-identity > .text-shadow { width: 100%; }
.web-home .home-header :deep(.pn-widget-shell) { height: auto; container-type: normal; }
.web-home .home-header :deep(.pn-widget-shell > *) { height: auto; overflow: visible; }
.web-home .home-identity :deep(.clock) { color: #fff; }
.web-home .logo span { font-size: 14px; font-weight: 500; letter-spacing: .06em; }
.web-home .divider { display: none; }
.web-home .home-identity :deep(.clock-time) { font-size: clamp(48px, 6vw, 88px); font-weight: 300; line-height: 1.15; letter-spacing: -.035em; }
.web-home .home-identity :deep(.clock-date), .web-home .home-identity :deep(.clock-week) { font-size: 13px; font-weight: 400; opacity: .8; }
.web-home .header-weather { position: absolute; right: 0; bottom: 0; width: 190px; margin: 0; }
.web-home .home-search { width: min(100%, 640px); margin-top: 26px; }
.web-home .home-search :deep(.search-container) { border-radius: 20px; border: 1px solid var(--pn-glass-border); background: var(--pn-glass-surface) !important; backdrop-filter: var(--pn-glass-control-filter); box-shadow: var(--pn-glass-highlight); }
.web-home .item-list { margin-top: 36px; }
.web-home .group-title { font-size: 17px; font-weight: 600; }
.web-home .icon-small-box { grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 24px 18px; }
.web-home .fixed-element { right: 18px; bottom: 28px; padding: 6px; border: 1px solid var(--pn-glass-border); border-radius: 18px; background: var(--pn-glass-surface); backdrop-filter: var(--pn-glass-control-filter); box-shadow: var(--pn-glass-highlight); }
.web-home .fixed-element :deep(.n-button) { color: var(--pn-color-text-primary) !important; background: transparent !important; border-radius: 12px !important; }
.web-home .fixed-element :deep(.n-button svg) { color: var(--pn-color-text-primary); }
.web-home .fixed-element :deep(.n-button__border), .web-home .fixed-element :deep(.n-button__state-border) { border: 0; }
.web-add-icon { display: grid; justify-items: center; gap: 10px; width: 100%; border: 0; padding: 0; background: transparent; color: inherit; cursor: pointer; }
.web-add-icon > span { display: grid; place-items: center; width: 70px; height: 70px; border: 1px dashed var(--pn-glass-border); border-radius: var(--pn-bookmark-icon-radius, 18px); background: var(--pn-glass-control); color: var(--pn-color-text-primary); }
.web-add-icon svg { width: 26px; height: 26px; }
.web-add-icon small { font-size: 12px; color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / 18%); }
.web-add-icon:hover > span { background: var(--pn-glass-detail); }
.web-add-icon:focus-visible { outline: 2px solid var(--pn-color-accent); outline-offset: 5px; border-radius: 12px; }
@media (max-width: 800px) { .web-home .header-weather { position: static; width: 190px; } }
@media (max-width: 640px) { .web-home .home-content { padding: 48px 16px 24px; } .web-home .icon-small-box { grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 20px 10px; } }

.home-groups-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: min(100%, 460px);
  min-height: 190px;
  margin: 48px auto;
  padding: 28px;
  border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 18%));
  border-radius: var(--pn-radius-large, 18px);
  color: var(--pn-widget-text-color, #fff);
  background: var(--pn-widget-background, rgb(18 25 39 / 55%));
  box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%));
  text-align: center;
  backdrop-filter: blur(var(--pn-effect-blur, 14px));
}
.home-groups-empty-icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: var(--pn-radius-medium, 12px); background: color-mix(in srgb, var(--pn-color-accent, #10b981) 20%, transparent); }
.home-groups-empty-icon :deep(svg) { width: 22px; height: 22px; }
.home-groups-empty strong { font-size: 17px; }
.home-groups-empty p { max-width: 36ch; margin: 0 0 4px; color: var(--pn-widget-muted-text, rgb(255 255 255 / 72%)); font-size: 13px; line-height: 1.6; }
.home-groups-empty :deep(.n-button) { min-height: 40px; }
.group-action { display: inline-grid; width: 36px; height: 36px; place-items: center; border: 0; border-radius: var(--pn-radius-small, 8px); color: #fff; background: transparent; cursor: pointer; }
.group-action:hover { background: rgb(255 255 255 / 18%); }
.item-list:focus-within .group-buttons { opacity: 1; }
@media (pointer: coarse) { .group-buttons { opacity: 1 !important; } .group-action { width: 42px; height: 42px; } }

.mask {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.sun-main {
  position: relative;
  overflow: hidden;
  user-select: none;
}

.runtime-status-bar {
  position: fixed;
  z-index: 40;
  top: 16px;
  right: 18px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
  max-width: calc(100% - 36px);
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border: 1px solid var(--pn-color-border, rgb(255 255 255 / 16%));
  border-radius: var(--pn-radius-round, 999px);
  color: var(--pn-sidebar-text-color, #fff);
  background: var(--pn-sidebar-background, rgb(18 25 39 / 68%));
  box-shadow: var(--pn-effect-shadow-low, 0 8px 28px rgb(0 0 0 / 16%));
  backdrop-filter: blur(var(--pn-effect-blur, 14px));
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.sync-indicator {
  cursor: pointer;
}

.sync-indicator:disabled {
  cursor: wait;
}

.sync-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
}

.status-online .status-dot {
  background: #4ade80;
}

.status-offline .status-dot {
  background: #f59e0b;
}

.sync-online .sync-dot {
  background: #4ade80;
  box-shadow: 0 0 10px rgb(74 222 128 / 80%);
}

.sync-cached .sync-dot,
.sync-syncing .sync-dot {
  background: #60a5fa;
}

.sync-offline .sync-dot,
.sync-error .sync-dot {
  background: #f59e0b;
}

@media (max-width: 640px) {
  .runtime-status-bar {
    top: 10px;
    right: 10px;
    max-width: calc(100% - 20px);
  }

  .status-chip {
    padding: 7px 9px;
  }
}

.extension-home .home-content {
  box-sizing: border-box;
  min-height: 100%;
  padding: 44px 54px 90px;
}

.extension-home .home-header {
  width: min(100%, 920px);
  margin: 0 auto 38px;
}

.extension-home .home-identity {
  justify-content: space-between;
  gap: 18px;
  padding: 0 8px;
}

.extension-home .logo span {
  font-size: clamp(24px, 3vw, 42px);
  letter-spacing: -.04em;
}

.extension-home .divider {
  display: none;
}

.header-weather {
  margin-left: 18px;
}

.home-widgets {
  width: 100%;
  max-width: 100%;
}

.widget-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 10px;
}

.widget-tool-button {
  padding: 6px 12px;
  border: 1px solid var(--pn-color-border, rgb(255 255 255 / 18%));
  border-radius: var(--pn-radius-round, 999px);
  color: var(--pn-widget-text-color, white);
  background: var(--pn-widget-background, rgb(18 25 39 / 68%));
  box-shadow: var(--pn-effect-shadow-low, 0 8px 28px rgb(0 0 0 / 16%));
  backdrop-filter: blur(var(--pn-effect-blur, 14px));
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}

.widget-tool-button:hover {
  background: rgb(38 48 70 / 78%);
}

.widget-tool-button:disabled {
  cursor: wait;
  opacity: .55;
}

.widget-grid {
  --widget-grid-row-height: 96px;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: var(--widget-grid-row-height);
  gap: 14px;
  align-items: stretch;
}

.widget-grid-editing {
  outline: 1px dashed rgb(255 255 255 / 22%);
  outline-offset: 8px;
  border-radius: 12px;
}

.widget-cell {
  position: relative;
  display: flex;
  min-width: 0;
  touch-action: pan-y;
}
.widget-cell.is-long-press-dragging { opacity: .78; transform: scale(.985); outline: 2px solid rgb(103 232 249 / 72%); outline-offset: 3px; }
.widget-cell.is-resizing { z-index: 8; outline: 2px solid rgb(103 232 249 / 78%); outline-offset: 2px; }
.is-bookmark-long-pressing { opacity: .78; transform: scale(.96); outline: 2px solid rgb(103 232 249 / 72%); outline-offset: 3px; border-radius: 16px; }

.widget-cell > * {
  flex: 1;
  min-width: 0;
}

.widget-edit-card,
.widget-hidden-card {
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  border: 1px dashed var(--pn-widget-border, rgb(255 255 255 / 38%));
  border-radius: var(--pn-radius-large, 16px);
}

.widget-edit-card > :deep(*) {
  position: relative;
  z-index: 0;
}

.widget-edit-bar {
  position: absolute;
  z-index: 10;
  top: 6px;
  right: 8px;
  display: flex;
  max-width: calc(100% - 16px);
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 3px;
  padding: 3px 6px;
  border-radius: 999px;
  background: rgb(18 25 39 / 82%);
  box-shadow: 0 6px 18px rgb(0 0 0 / 28%);
}

.widget-stack-member-badge {
  padding: 1px 5px;
  border-radius: 999px;
  color: rgb(165 243 252 / 92%);
  background: rgb(8 145 178 / 20%);
  font-size: 10px;
  line-height: 1.5;
  white-space: nowrap;
}

.widget-edit-handle {
  color: rgb(255 255 255 / 85%);
  cursor: grab;
  font-size: 13px;
  line-height: 1.4;
  user-select: none;
}

.widget-edit-action {
  min-width: 22px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: rgb(255 255 255 / 85%);
  cursor: pointer;
  font-size: 12px;
  line-height: 1.4;
}

.widget-edit-action:disabled {
  cursor: default;
  opacity: .3;
}

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
  border: 2px solid rgb(103 232 249);
  border-top: 0;
  border-left: 0;
  border-radius: 0 0 5px;
  cursor: nwse-resize;
}
:global(html.is-widget-resizing),
:global(html.is-widget-resizing *) { cursor: nwse-resize !important; user-select: none !important; }

.widget-hidden-card {
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 56px;
  padding: 10px 14px;
  color: rgb(255 255 255 / 72%);
  background: rgb(18 25 39 / 42%);
}

.widget-hidden-name {
  overflow: hidden;
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.extension-home .header-weather {
  margin-left: auto;
}

.extension-home .home-identity :deep(.clock) {
  width: auto;
  text-align: right;
}

.extension-home .home-search {
  width: 100%;
  margin-top: 24px;
}

.extension-home .home-search :deep(.search-container) {
  min-height: 52px;
  border: 1px solid var(--pn-search-border, var(--pn-widget-border, rgb(255 255 255 / 24%)));
  border-radius: var(--pn-search-radius, var(--pn-radius-large, 16px));
  background: var(--pn-search-background, var(--pn-widget-background, rgb(18 25 39 / 58%))) !important;
  box-shadow: var(--pn-effect-shadow-medium, 0 18px 60px rgb(0 0 0 / 18%));
  backdrop-filter: blur(var(--pn-effect-blur, 18px));
}

.extension-home .home-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  gap: 22px;
}

.extension-home .item-list {
  min-width: 0;
  margin-top: 0;
  padding: 22px;
  border: 1px solid var(--pn-bookmark-card-border, rgb(255 255 255 / 14%));
  border-radius: var(--pn-radius-large, 24px);
  background: var(--pn-bookmark-card-background, rgb(18 25 39 / 42%));
  box-shadow: var(--pn-bookmark-card-shadow, 0 18px 60px rgb(0 0 0 / 14%));
  backdrop-filter: blur(var(--pn-effect-blur, 18px));
}

.extension-home .item-list > :first-child {
  margin-bottom: 16px;
  margin-left: 0;
  font-size: 16px;
}

.extension-home .icon-small-box {
  grid-template-columns: repeat(auto-fill, minmax(82px, 1fr));
  gap: 16px 12px;
}

.extension-home .icon-info-box {
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}

.cover {
  position: absolute;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* background: url(@/assets/start_sky.jpg) no-repeat; */

  transform: scale(1.05);
}

.text-shadow {
  text-shadow: 0 1px 3px rgb(0 0 0 / 18%);
}

.app-icon-text-shadow {
  text-shadow: 0 1px 2px rgb(0 0 0 / 18%);
}

.fixed-element {
  position: fixed;
  /* 将元素固定在屏幕上 */
  right: 10px;
  /* 距离屏幕顶部的距离 */
  bottom: 50px;
  /* 距离屏幕左侧的距离 */
}

.icon-info-box {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 18px;

}

.icon-small-box {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(75px, 1fr));
  gap: 18px;

}

@media (max-width: 500px) {
  .icon-info-box{
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }

  .home-identity {
    flex-wrap: wrap;
    gap: 10px;
  }

  .header-weather {
    display: flex;
    width: 100%;
    justify-content: center;
    margin: 8px 0 0;
  }

  .home-widgets {
    margin-top: 14px;
  }

  .widget-grid {
    gap: 10px;
  }

  .widget-cell {
    grid-column: span 12 / span 12 !important;
  }

  .widget-resize-handle.is-right {
    display: none;
  }

  .widget-edit-bar {
    gap: 1px;
  }

  .extension-home .home-content {
    padding: 26px 18px 80px;
  }

  .extension-home .home-identity {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .extension-home .header-weather {
    width: 100%;
    margin-left: 0;
  }

  .extension-home .home-groups {
    grid-template-columns: 1fr;
  }

  .extension-home .item-list {
    padding: 18px 14px;
  }
}
</style>
