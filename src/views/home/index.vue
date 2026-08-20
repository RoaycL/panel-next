<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { NBackTop, NButton, NButtonGroup, NDropdown, NModal, NSkeleton, NSpin, useDialog, useMessage } from 'naive-ui'
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { AppIcon } from './components'
import { SystemMonitor } from '@/components/deskModule'
import { SvgIcon } from '@/components/common'
import { deletes, getListByGroupId, saveSort } from '@/api/panel/itemIcon'
import { getList as getGroupList } from '@/api/panel/itemIconGroup'
import { set as setUserConfig } from '@/api/panel/userConfig'

import { setTitle, updateLocalUserInfo } from '@/utils/cmn'
import { useAuthStore, usePanelState, useUserStore } from '@/store'
import { PanelPanelConfigStyleEnum, PanelStateNetworkModeEnum } from '@/enums'
import { VisitMode } from '@/enums/auth'
import { router } from '@/router'
import { t } from '@/locales'
import { getRuntime } from '@/runtime'
import { readBootstrapSnapshot, refreshBootstrapSnapshot } from '@/sync/bootstrapCache'
import { getBootstrap } from '@/api/sync'
import { onSyncConflict, setSyncRevision } from '@/sync/revision'
import type { DashboardGroup } from '@/dashboard/core'
import { createDashboardState, createItemSortRequest, filterDashboardGroups, normalizeDashboardGroups, selectItemUrl } from '@/dashboard/core'
import type { WidgetInstance } from '@/widgets'
import { WidgetHost, createHeaderClockWidget, createHeaderSearchWidget, createHeaderWeatherWidget, createTrendingWidget, createCountdownWidget, generateWidgetInstanceId, serializeWidgetLayout, widgetRegistry } from '@/widgets'

withDefaults(defineProps<{
  layout?: 'web' | 'extension'
}>(), {
  layout: 'web',
})

const ms = useMessage()
const dialog = useDialog()
const panelState = usePanelState()
const authStore = useAuthStore()
const userStore = useUserStore()
const runtime = getRuntime()
const AppStarter = defineAsyncComponent(() => import('./components/AppStarter/index.vue'))
const EditItem = defineAsyncComponent(() => import('./components/EditItem/index.vue'))

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

const settingModalShow = ref(false)

const items = ref<DashboardGroup[]>([])
const filterItems = ref<DashboardGroup[]>([])
const searchKeyword = ref('')
const browserOnline = ref(navigator.onLine)
type ExtensionSyncStatus = 'idle' | 'syncing' | 'online' | 'cached' | 'offline' | 'error'
const extensionSyncStatus = ref<ExtensionSyncStatus>(runtime.kind === 'extension' ? 'syncing' : 'idle')
const lastSyncAt = ref<string | null>(null)
let hasCachedSnapshot = false
let extensionRefreshPromise: Promise<void> | null = null
let removeSyncConflictListener: (() => void) | null = null

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
const headerSearchWidget = createHeaderSearchWidget()
const headerWeatherWidget = createHeaderWeatherWidget()

const widgetInstances = ref<WidgetInstance[]>([])
const widgetEditMode = ref(false)
const widgetLayoutDirty = ref(false)
const widgetLayoutSaving = ref(false)

function createDefaultWidgetInstances(): WidgetInstance[] {
  return [createTrendingWidget(), createCountdownWidget(t('countdown.newYearDay'), '2027-01-01', 'yearly')]
}

function buildWidgetInstances(stored: unknown): WidgetInstance[] {
  if (!stored)
    return createDefaultWidgetInstances()
  try {
    const result = widgetRegistry.loadLayout(stored)
    if (result.droppedWidgetIds.length)
      console.warn('Dropped invalid widget instances.', result.droppedWidgetIds)
    return result.layout.widgets
  }
  catch {
    return createDefaultWidgetInstances()
  }
}

// 布局来自面板配置，随 bootstrap/增量同步刷新；编辑中的未保存改动不被后台刷新覆盖。
watch(() => panelState.panelConfig.widgets, (stored) => {
  if (widgetEditMode.value && widgetLayoutDirty.value)
    return
  widgetInstances.value = buildWidgetInstances(stored)
}, { immediate: true })

const visibleWidgetInstances = computed(() => widgetInstances.value.filter(instance => !instance.hidden))

const widgetAddOptions = computed(() => widgetRegistry.list().map(definition => ({
  label: t(`widgetLayout.types.${definition.type}`),
  key: definition.type,
})))

function widgetTypeLabel(type: string) {
  return t(`widgetLayout.types.${type}`)
}

function widgetCellStyle(instance: WidgetInstance) {
  const columns = Math.min(Math.max(instance.size.columns, 1), 12)
  return {
    gridColumn: `span ${columns} / span ${columns}`,
    gridRow: `span ${Math.max(instance.size.rows, 1)}`,
  }
}

function canResizeWidget(instance: WidgetInstance, axis: 'columns' | 'rows', delta: number) {
  const bounds = widgetRegistry.get(instance.type)?.size
  if (!bounds)
    return false
  const next = instance.size[axis] + delta
  return next >= bounds.min[axis] && next <= bounds.max[axis]
}

function resizeWidget(instance: WidgetInstance, axis: 'columns' | 'rows', delta: number) {
  const bounds = widgetRegistry.get(instance.type)?.size
  if (!bounds)
    return
  const next = Math.min(bounds.max[axis], Math.max(bounds.min[axis], instance.size[axis] + delta))
  if (next !== instance.size[axis]) {
    instance.size[axis] = next
    widgetLayoutDirty.value = true
  }
}

function toggleWidgetHidden(instance: WidgetInstance) {
  instance.hidden = !instance.hidden
  widgetLayoutDirty.value = true
}

function removeWidgetInstance(index: number) {
  widgetInstances.value.splice(index, 1)
  widgetLayoutDirty.value = true
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
  widgetEditMode.value = true
  widgetLayoutDirty.value = false
}

function cancelWidgetLayoutEdit() {
  widgetInstances.value = buildWidgetInstances(panelState.panelConfig.widgets)
  widgetLayoutDirty.value = false
  widgetEditMode.value = false
}

async function saveWidgetLayout() {
  if (widgetLayoutSaving.value)
    return
  widgetLayoutSaving.value = true
  try {
    panelState.panelConfig.widgets = serializeWidgetLayout(widgetInstances.value)
    panelState.recordState()
    const { code, msg } = await setUserConfig({ panel: panelState.panelConfig })
    if (code === 0) {
      widgetLayoutDirty.value = false
      widgetEditMode.value = false
      ms.success(t('widgetLayout.saveSuccess'))
    }
    else {
      ms.error(`${t('widgetLayout.saveFail')}:${msg}`)
    }
  }
  finally {
    widgetLayoutSaving.value = false
  }
}

function openPage(openMethod: number, url: string, title?: string) {
  switch (openMethod) {
    case 1:
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

function handleItemClick(itemGroup: DashboardGroup, item: Panel.ItemInfo) {
  if (itemGroup.sortStatus) {
    handleEditItem(item)
    return
  }
  const jumpUrl = selectItemUrl(item, panelState.networkMode === PanelStateNetworkModeEnum.lan)
  openPage(item.openMethod, jumpUrl, item.title)
}

function handWindowIframeIdLoad(_payload: Event) {
  windowIframeIsLoad.value = false
}

async function getList() {
  // 获取组数据
  const { code, data } = await getGroupList<Common.ListResponse<Panel.ItemIconGroup[]>>()
  if (code !== 0 || !data?.list)
    return false
  items.value = normalizeDashboardGroups(data.list)
  await Promise.all(items.value.map(async (element, index) => {
    if (element.id)
      await updateItemIconGroupByNet(index, element.id)
  }))
  refreshFilteredItems()
  return true
}

// 从后端获取组下面的图标
async function updateItemIconGroupByNet(itemIconGroupIndex: number, itemIconGroupId: number) {
  const res = await getListByGroupId<Common.ListResponse<Panel.ItemInfo[]>>(itemIconGroupId)
  if (res.code === 0 && items.value[itemIconGroupIndex]) {
    items.value[itemIconGroupIndex].items = res.data.list
    refreshFilteredItems()
  }
}

function handleRightMenuSelect(key: string | number) {
  dropdownShow.value = false
  // console.log(currentRightSelectItem, key)
  const jumpUrl = currentRightSelectItem.value
    ? selectItemUrl(currentRightSelectItem.value, panelState.networkMode === PanelStateNetworkModeEnum.lan)
    : ''
  switch (key) {
    case 'newWindows':
      runtime.openUrl(jumpUrl || '', 'tab')
      break
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
function handleAuxClick(e: MouseEvent, itemGroup: DashboardGroup, item: Panel.ItemInfo) {
  if (e.button === 1) {
    e.preventDefault()
    const jumpUrl = selectItemUrl(item, panelState.networkMode === PanelStateNetworkModeEnum.lan)
    runtime.openUrl(jumpUrl, 'tab')
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

function handleEditSuccess(_item: Panel.ItemInfo) {
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
      icon: () => h(SvgIcon, { icon: 'mdi:open-in-new' }),
    },

  ]

  // CARD-09: 展示所有已填写地址
  if (currentRightSelectItem.value?.url) {
    dropdownMenuOptions.push({
      label: t('panelHome.openWanUrl'),
      key: 'openWanUrl',
      icon: () => h(SvgIcon, { icon: 'mdi:web' }),
    })
  }

  if (currentRightSelectItem.value?.lanUrl) {
    dropdownMenuOptions.push({
      label: t('panelHome.openLanUrl'),
      key: 'openLanUrl',
      icon: () => h(SvgIcon, { icon: 'mdi:lan' }),
    })
  }

  if (canEdit.value) {
    dropdownMenuOptions.push({
      label: t('common.edit'),
      key: 'edit',
      icon: () => h(SvgIcon, { icon: 'mdi:pencil' }),
    }, {
      label: t('common.delete'),
      key: 'delete',
      icon: () => h(SvgIcon, { icon: 'mdi:delete' }),
    })
  }

  return dropdownMenuOptions
}

function applyBootstrapData(data: Sync.BootstrapResponseV1) {
  const dashboard = createDashboardState(data)
  setSyncRevision(dashboard.revision)
  panelState.applyPanelConfig(dashboard.panelConfig)
  authStore.setUserInfo(dashboard.account)
  authStore.setVisitMode(VisitMode.VISIT_MODE_LOGIN)
  userStore.updateUserInfo(dashboard.account)
  items.value = dashboard.groups
  refreshFilteredItems()
  if (panelState.panelConfig.logoText)
    setTitle(panelState.panelConfig.logoText)
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
  void refreshExtensionBootstrap()
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
  removeSyncConflictListener = onSyncConflict(handleSyncConflict)
  window.addEventListener('online', handleBrowserOnline)
  window.addEventListener('offline', handleBrowserOffline)
  if (runtime.kind === 'extension') {
    void refreshExtensionBootstrap()
    return
  }

  // 更新用户信息
  await updateLocalUserInfo()

  if (authStore.visitMode === VisitMode.VISIT_MODE_LOGIN && authStore.authMode === 'device') {
    const bootstrap = await getBootstrap()
    if (bootstrap.code === 0) {
      applyBootstrapData(bootstrap.data)
      return
    }
  }

  // 分组、卡片和面板配置来自同一个已验证会话，可以并行加载。
  await Promise.all([getList(), panelState.updatePanelConfigByCloud()])

  // 设置标题
  if (panelState.panelConfig.logoText)
    setTitle(panelState.panelConfig.logoText)
})

onUnmounted(() => {
  removeSyncConflictListener?.()
  window.removeEventListener('online', handleBrowserOnline)
  window.removeEventListener('offline', handleBrowserOffline)
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
  editItemInfoData.value = null
  editItemInfoShow.value = true
  if (itemIconGroupId)
    currentAddItenIconGroupId.value = itemIconGroupId
}
</script>

<template>
  <div class="w-full h-full sun-main" :class="{ 'extension-home': layout === 'extension' }">
    <div
      class="cover wallpaper" :style="{
        filter: `blur(${panelState.panelConfig.backgroundBlur}px)`,
        background: `url(${panelState.panelConfig.backgroundImageSrc}) no-repeat`,
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
      <span class="status-chip" :title="sessionTitle">{{ sessionLabel }}</span>
    </div>
    <div ref="scrollContainerRef" class="absolute w-full h-full overflow-auto">
      <div
        class="home-content p-2.5 mx-auto"
        :style="{
          marginTop: layout === 'extension' ? '0' : `${panelState.panelConfig.marginTop}%`,
          marginBottom: `${panelState.panelConfig.marginBottom}%`,
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
          <div class="home-widgets mx-auto mt-[24px] w-full">
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
                <button type="button" class="widget-tool-button" :disabled="widgetLayoutSaving" @click="saveWidgetLayout">
                  {{ t('widgetLayout.save') }}
                </button>
                <button type="button" class="widget-tool-button" @click="cancelWidgetLayoutEdit">
                  {{ t('widgetLayout.cancel') }}
                </button>
              </template>
            </div>

            <!-- 浏览模式 -->
            <div v-if="!widgetEditMode" class="widget-grid">
              <div
                v-for="instance in visibleWidgetInstances" :key="instance.id"
                class="widget-cell" :style="widgetCellStyle(instance)"
              >
                <WidgetHost :instance="instance" @item-search="itemFrontEndSearch" />
              </div>
            </div>

            <!-- 编辑模式：拖放排序、缩放、隐藏与删除 -->
            <VueDraggable
              v-else
              v-model="widgetInstances" item-key="id" :animation="200"
              handle=".widget-edit-handle"
              class="widget-grid widget-grid-editing"
            >
              <div
                v-for="(instance, index) in widgetInstances" :key="instance.id"
                class="widget-cell" :style="widgetCellStyle(instance)"
              >
                <div v-if="instance.hidden" class="widget-hidden-card">
                  <span class="widget-edit-handle" :title="t('widgetLayout.drag')">{{ '⠿' }}</span>
                  <span class="widget-hidden-name">{{ widgetTypeLabel(instance.type) }}</span>
                  <button type="button" class="widget-edit-action" :title="t('widgetLayout.show')" @click="toggleWidgetHidden(instance)">
                    {{ '👁' }}
                  </button>
                  <button type="button" class="widget-edit-action" :title="t('widgetLayout.remove')" @click="removeWidgetInstance(index)">
                    {{ '✕' }}
                  </button>
                </div>
                <div v-else class="widget-edit-card">
                  <div class="widget-edit-bar">
                    <span class="widget-edit-handle" :title="t('widgetLayout.drag')">{{ '⠿' }}</span>
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
                    <button type="button" class="widget-edit-action" :title="t('widgetLayout.remove')" @click="removeWidgetInstance(index)">
                      {{ '✕' }}
                    </button>
                  </div>
                  <WidgetHost :instance="instance" @item-search="itemFrontEndSearch" />
                </div>
              </div>
            </VueDraggable>
          </div>
        </div>

        <!-- 应用盒子 -->
        <div
          class="home-groups"
          :style="layout === 'extension'
            ? undefined
            : { marginLeft: `${panelState.panelConfig.marginX}px`, marginRight: `${panelState.panelConfig.marginX}px` }"
        >
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
            :class="itemGroup.sortStatus ? 'shadow-2xl border shadow-[0_0_30px_10px_rgba(0,0,0,0.3)]  p-[10px] rounded-2xl' : ''"
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
                <span class="mr-2 cursor-pointer" :title="t('common.add')" @click="handleAddItem(itemGroup.id)">
                  <SvgIcon class="text-white font-xl" icon="typcn:plus" />
                </span>
                <span class="mr-2 cursor-pointer " :title="t('common.sort')" @click="handleSetSortStatus(itemGroup, !itemGroup.sortStatus)">
                  <SvgIcon class="text-white font-xl" icon="ri:drag-drop-line" />
                </span>
              </div>
            </div>

            <!-- 详情图标 -->
            <div v-if="panelState.panelConfig.iconStyle === PanelPanelConfigStyleEnum.info">
              <div v-if="itemGroup.items">
                <VueDraggable
                  v-model="itemGroup.items" item-key="sort" :animation="300"
                  class="icon-info-box"
                  filter=".not-drag"
                  :disabled="!itemGroup.sortStatus"
                >
                  <div v-for="item, index in itemGroup.items" :key="index" :title="item.description" @contextmenu="(e) => handleContextMenu(e, itemGroup, item)" @auxclick="(e) => handleAuxClick(e, itemGroup, item)">
                    <AppIcon
                      :class="itemGroup.sortStatus ? 'cursor-move' : 'cursor-pointer'"
                      :item-info="item"
                      :icon-text-color="panelState.panelConfig.iconTextColor"
                      :icon-text-info-hide-description="panelState.panelConfig.iconTextInfoHideDescription || false"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :style="0"
                      @click="handleItemClick(itemGroup, item)"
                    />
                  </div>

                  <div v-if="itemGroup.items.length === 0" class="not-drag">
                    <AppIcon
                      :class="itemGroup.sortStatus ? 'cursor-move' : 'cursor-pointer'"
                      :item-info="{ icon: { itemType: 3, text: 'subway:add' }, title: t('common.add'), url: '', openMethod: 0 }"
                      :icon-text-color="panelState.panelConfig.iconTextColor"
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
                  v-model="itemGroup.items" item-key="sort" :animation="300"
                  class="icon-small-box"

                  filter=".not-drag"
                  :disabled="!itemGroup.sortStatus"
                >
                  <div v-for="item, index in itemGroup.items" :key="index" :title="item.description" @contextmenu="(e) => handleContextMenu(e, itemGroup, item)" @auxclick="(e) => handleAuxClick(e, itemGroup, item)">
                    <AppIcon
                      :class="itemGroup.sortStatus ? 'cursor-move' : 'cursor-pointer'"
                      :item-info="item"
                      :icon-text-color="panelState.panelConfig.iconTextColor"
                      :icon-text-info-hide-description="!panelState.panelConfig.iconTextInfoHideDescription"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :style="1"
                      @click="handleItemClick(itemGroup, item)"
                    />
                  </div>

                  <div v-if="itemGroup.items.length === 0" class="not-drag">
                    <AppIcon
                      class="cursor-pointer"
                      :item-info="{ icon: { itemType: 3, text: 'subway:add' }, title: $t('common.add'), url: '', openMethod: 0 }"
                      :icon-text-color="panelState.panelConfig.iconTextColor"
                      :icon-text-info-hide-description="!panelState.panelConfig.iconTextInfoHideDescription"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :style="1"
                      @click="handleAddItem(itemGroup.id)"
                    />
                  </div>
                </vuedraggable>
              </div>
            </div>

            <!-- 编辑栏 -->
            <div v-if="itemGroup.sortStatus" class="flex mt-[10px]">
              <div>
                <NButton color="#2a2a2a6b" @click="handleSaveSort(itemGroup)">
                  <template #icon>
                    <SvgIcon class="text-white font-xl" icon="material-symbols:save" />
                  </template>
                  <div>
                    {{ $t('common.saveSort') }}
                  </div>
                </NButton>
              </div>
            </div>
          </div>
        </div>
        <div class="mt-5 footer" v-html="panelState.panelConfig.footerHtml" />
      </div>
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
            <SvgIcon class="text-white font-xl" icon="material-symbols:lan-outline-rounded" />
          </template>
        </NButton>

        <NButton
          v-if="panelState.networkMode === PanelStateNetworkModeEnum.wan && panelState.panelConfig.netModeChangeButtonShow" color="#2a2a2a6b"
          :title="t('panelHome.changeToLanModel')" @click="handleChangeNetwork(PanelStateNetworkModeEnum.lan)"
        >
          <template #icon>
            <SvgIcon class="text-white font-xl" icon="mdi:wan" />
          </template>
        </NButton>

        <NButton v-if="canEdit" color="#2a2a2a6b" :title="t('appLauncher.title')" @click="settingModalShow = !settingModalShow">
          <template #icon>
            <SvgIcon class="text-white font-xl" icon="majesticons-applications" />
          </template>
        </NButton>

        <NButton v-if="authStore.visitMode === VisitMode.VISIT_MODE_PUBLIC" color="#2a2a2a6b" :title="$t('panelHome.goToLogin')" @click="router.push('/login')">
          <template #icon>
            <SvgIcon class="text-white font-xl" icon="material-symbols:account-circle" />
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
            <SvgIcon class="text-white font-xl" icon="icon-park-outline:to-top" />
          </template>
        </NButton>
      </div>
    </NBackTop>

    <EditItem v-if="editItemInfoShow" v-model:visible="editItemInfoShow" :item-info="editItemInfoData" :item-group-id="currentAddItenIconGroupId" @done="handleEditSuccess" />

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
.mask {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.sun-main {
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
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 999px;
  color: #fff;
  background: rgb(18 25 39 / 68%);
  box-shadow: 0 8px 28px rgb(0 0 0 / 16%);
  backdrop-filter: blur(14px);
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
  max-width: min(100%, 940px);
}

.widget-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 10px;
}

.widget-tool-button {
  padding: 6px 12px;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 999px;
  color: white;
  background: rgb(18 25 39 / 68%);
  box-shadow: 0 8px 28px rgb(0 0 0 / 16%);
  backdrop-filter: blur(14px);
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
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 14px;
  align-items: stretch;
}

.widget-grid-editing {
  outline: 1px dashed rgb(255 255 255 / 22%);
  outline-offset: 8px;
  border-radius: 12px;
}

.widget-cell {
  display: flex;
  min-width: 0;
}

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
  border: 1px dashed rgb(255 255 255 / 38%);
  border-radius: 16px;
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
  gap: 3px;
  padding: 3px 6px;
  border-radius: 999px;
  background: rgb(18 25 39 / 82%);
  box-shadow: 0 6px 18px rgb(0 0 0 / 28%);
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
  border-color: rgb(255 255 255 / 24%);
  background: rgb(18 25 39 / 58%) !important;
  box-shadow: 0 18px 60px rgb(0 0 0 / 18%);
  backdrop-filter: blur(18px);
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
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 24px;
  background: rgb(18 25 39 / 42%);
  box-shadow: 0 18px 60px rgb(0 0 0 / 14%);
  backdrop-filter: blur(18px);
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
  text-shadow: 2px 2px 50px rgb(0, 0, 0);
}

.app-icon-text-shadow {
  text-shadow: 2px 2px 5px rgb(0, 0, 0);
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
