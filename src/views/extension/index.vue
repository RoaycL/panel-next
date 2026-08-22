<script setup lang="ts">
import { computed, defineAsyncComponent, h, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NAvatar,
  NDropdown,
  NModal,
  NSwitch,
  useDialog,
  useMessage,
} from 'naive-ui'
import { t } from '@/locales'
import type { WidgetInstance } from '@/widgets'
import { WidgetHost, WidgetSettingsModal, generateWidgetInstanceId, resizeInstanceWithinBounds, serializeWidgetLayout, widgetRegistry } from '@/widgets'
import { useRouter } from 'vue-router'
import { SvgIcon, ItemIcon, ConflictResolverModal, OfflineQueueManager } from '@/components/common'
import { useAuthStore, usePanelState, useUserStore } from '@/store'
import { getLocalState as getLocalPanelState } from '@/store/modules/panel/helper'
import { PanelStateNetworkModeEnum } from '@/enums'
import { VisitMode } from '@/enums/auth'
import { getRuntime } from '@/runtime'
import type { StorageChangeEvent } from '@/runtime/types'
import { EXTENSION_APPEARANCE_KEY, EXTENSION_WIDGETS_KEY, processPendingWidgetCleanups, readExtensionAppearance, readExtensionWidgets, removeExtensionWidgetFlow, saveExtensionAppearance, saveExtensionWidgets } from '@/runtime/extensionAppearance'
import { BOOTSTRAP_SNAPSHOT_KEY_PREFIX, readBootstrapSnapshot, refreshBootstrapSnapshot } from '@/sync/bootstrapCache'
import { onSyncConflict, setSyncRevision } from '@/sync/revision'
import { replayOfflineQueue } from '@/sync/offlineReplay'
import { getPendingMutationCount, OFFLINE_QUEUE_KEY_PREFIX, onOfflineQueueChanged } from '@/sync/offlineQueue'
import type { ConflictDescriptor, ConflictResolutionChoice } from '@/sync/conflictResolver'
import { getBootstrap } from '@/api/sync'
import { getList as getGroupList } from '@/api/panel/itemIconGroup'
import { getListByGroupId } from '@/api/panel/itemIcon'
import type { DashboardGroup } from '@/dashboard/core'
import { createDashboardState, selectItemUrl } from '@/dashboard/core'
import { getWeather } from '@/api/weather'
import type { WeatherResponse } from '@/api/weather'
import { getTrending } from '@/api/trending'
import type { TrendingItem, TrendingSource } from '@/api/trending'
import { VueDraggable } from 'vue-draggable-plus'
import defaultBackground from '@/assets/defaultBackground.webp'

import SvgSrcBaidu from '@/assets/search_engine_svg/baidu.svg'
import SvgSrcBing from '@/assets/search_engine_svg/bing.svg'
import SvgSrcGoogle from '@/assets/search_engine_svg/google.svg'

const UserHubModal = defineAsyncComponent(() => import('./components/UserHubModal.vue'))
const EditItem = defineAsyncComponent(() => import('@/views/home/components/EditItem/index.vue'))
const GallerySelector = defineAsyncComponent(() => import('@/components/common/GallerySelector/index.vue'))

const router = useRouter()
const ms = useMessage()
const dialog = useDialog()
const panelState = usePanelState()
const authStore = useAuthStore()
const userStore = useUserStore()
const runtime = getRuntime()

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
const widgetPreferences = ref(readExtensionWidgets())
const extensionWidgetInstances = ref<WidgetInstance[]>([])
const extensionQuarantinedWidgets = ref<unknown[]>([])
const extensionWidgetSettingsVisible = ref(false)
const extensionWidgetSettingsInstance = ref<WidgetInstance | null>(null)
const isRemovingWidget = ref(false)
const isWidgetLayoutDirty = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

async function persistExtensionWidgets(): Promise<boolean> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    const layout = serializeWidgetLayout(extensionWidgetInstances.value, extensionQuarantinedWidgets.value)
    widgetPreferences.value.contentLayout = layout
    const success = await saveExtensionWidgets(widgetPreferences.value)
    if (success) {
      isWidgetLayoutDirty.value = false
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
  isWidgetLayoutDirty.value = true
  if (saveTimer)
    clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void persistExtensionWidgets()
  }, delay)
}

function onExtensionWidgetDragEnd() {
  isWidgetLayoutDirty.value = true
  void persistExtensionWidgets()
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

function loadExtensionWidgetLayout(layout: unknown) {
  try {
    const result = widgetRegistry.loadLayout(layout)
    extensionWidgetInstances.value = result.layout.widgets
    extensionQuarantinedWidgets.value = result.quarantinedWidgets
    if (result.issues.length)
      console.warn('Quarantined incompatible extension widgets.', result.issues)
  }
  catch (error) {
    extensionWidgetInstances.value = []
    extensionQuarantinedWidgets.value = []
    console.warn('Invalid extension widget layout was ignored.', error)
  }
}

loadExtensionWidgetLayout(widgetPreferences.value.contentLayout)

// 防抖保存实例拖拽/缩放/隐藏/设置修改
watch(extensionWidgetInstances, () => {
  if (!isRemovingWidget.value) {
    scheduleSaveExtensionWidgets(300)
  }
}, { deep: true })

// 监听固定组件偏好开关
watch([
  () => widgetPreferences.value.clock,
  () => widgetPreferences.value.search,
  () => widgetPreferences.value.weather,
  () => widgetPreferences.value.trending,
], () => {
  scheduleSaveExtensionWidgets(150)
})

const fixedExtensionWidgetTypes = new Set(['core.clock', 'core.search', 'core.weather', 'core.trending'])
const extensionWidgetAddOptions = computed(() => widgetRegistry.list()
  .filter(definition => (!definition.surfaces || definition.surfaces.includes('extension')) && !fixedExtensionWidgetTypes.has(definition.type))
  .map(definition => ({ label: widgetDefinitionTitle(definition), key: definition.type })))

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

function addExtensionWidget(type: string | number) {
  try {
    extensionWidgetInstances.value.push(widgetRegistry.create(String(type), generateWidgetInstanceId(String(type)), { column: 0, row: extensionWidgetInstances.value.length }))
    isWidgetLayoutDirty.value = true
    void persistExtensionWidgets()
  }
  catch (error) {
    ms.error(error instanceof Error ? error.message : '添加组件失败')
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

function resizeExtensionWidget(instance: WidgetInstance, axis: 'columns' | 'rows', delta: number) {
  resizeInstanceWithinBounds(instance, axis, delta)
  isWidgetLayoutDirty.value = true
  void persistExtensionWidgets()
}

function toggleExtensionWidgetHidden(instance: WidgetInstance) {
  instance.hidden = !instance.hidden
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
    )

    if (!result.success) {
      // 布局保存失败：恢复 UI
      extensionWidgetInstances.value = result.updatedInstances
      ms.error(t('widgetLayout.saveFail'))
      return
    }

    // 布局保存成功：更新组件状态
    extensionWidgetInstances.value = result.updatedInstances
    widgetPreferences.value.contentLayout = serializeWidgetLayout(
      result.updatedInstances,
      extensionQuarantinedWidgets.value,
    )

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

function extensionWidgetCellStyle(instance: WidgetInstance) {
  return {
    gridColumn: `span ${Math.min(12, Math.max(1, instance.size.columns))}`,
    gridRow: `span ${Math.max(1, instance.size.rows)}`,
  }
}

async function handleWallpaperSelect(url: string) {
  const previousBg = panelState.panelConfig.backgroundImageSrc
  panelState.panelConfig.backgroundImageSrc = url
  try {
    await saveExtensionAppearance(panelState.panelConfig)
    showWallpaperModal.value = false
    ms.success('已切换背景壁纸')
  }
  catch (error) {
    // Do not overwrite a newer appearance change that happened while this
    // save was awaiting extension storage.
    if (panelState.panelConfig.backgroundImageSrc === url)
      panelState.panelConfig.backgroundImageSrc = previousBg
    ms.error('保存壁纸设置失败，请重试')
    console.error('Failed to save wallpaper preference:', error)
  }
}

// 1. 时钟与日期
const currentTime = ref('')
const currentSeconds = ref('')
const currentDate = ref('')
const greeting = ref('')

let clockTimer: number | null = null

function updateClock() {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  currentTime.value = `${hours}:${minutes}`
  currentSeconds.value = seconds

  const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const date = now.getDate()
  const day = weekDays[now.getDay()]
  currentDate.value = `${year}年${month}月${date}日 · ${day}`

  const hVal = now.getHours()
  const username = userStore.userInfo?.name || userStore.userInfo?.username || authStore.userInfo?.name || ''
  const nameSuffix = username ? `，${username}` : ''
  if (hVal >= 5 && hVal < 12)
    greeting.value = `早上好${nameSuffix}`
  else if (hVal >= 12 && hVal < 14)
    greeting.value = `中午好${nameSuffix}`
  else if (hVal >= 14 && hVal < 18)
    greeting.value = `下午好${nameSuffix}`
  else if (hVal >= 18 && hVal < 23)
    greeting.value = `晚上好${nameSuffix}`
  else
    greeting.value = `夜深了${nameSuffix}`
}

// 2. 聚合搜索引擎
interface SearchEngine {
  id: string
  title: string
  url: string
  icon: string
  iconSrc?: string
}

const searchEngines: SearchEngine[] = [
  { id: 'baidu', title: '百度', url: 'https://www.baidu.com/s?wd=%s', icon: '', iconSrc: SvgSrcBaidu },
  { id: 'google', title: 'Google', url: 'https://www.google.com/search?q=%s', icon: '', iconSrc: SvgSrcGoogle },
  { id: 'bing', title: 'Bing', url: 'https://www.bing.com/search?q=%s', icon: '', iconSrc: SvgSrcBing },
  { id: 'github', title: 'GitHub', url: 'https://github.com/search?q=%s', icon: 'mdi:github' },
  { id: 'bilibili', title: 'Bilibili', url: 'https://search.bilibili.com/all?keyword=%s', icon: 'ri:bilibili-fill' },
  { id: 'duckduckgo', title: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', icon: 'simple-icons:duckduckgo' },
]

const currentEngine = ref<SearchEngine>(searchEngines[0])
const searchQuery = ref('')
const isSearchFocused = ref(false)

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
    currentEngine.value = found
}

function handleSearchSubmit() {
  const query = searchQuery.value.trim()
  if (!query)
    return
  const targetUrl = currentEngine.value.url.replace('%s', encodeURIComponent(query))
  runtime.openUrl(targetUrl, 'tab')
}

// 3. 天气与热搜
const weatherData = ref<WeatherResponse | null>(null)
const weatherCity = ref('北京')
const weatherUnavailable = ref(false)

async function fetchWeather() {
  try {
    const res = await getWeather(weatherCity.value, 'metric')
    if (res.code === 0) {
      weatherData.value = res.data
      weatherUnavailable.value = false
    }
    else {
      weatherUnavailable.value = true
    }
  }
  catch {
    weatherUnavailable.value = true
  }
}

const weatherEmoji = computed(() => {
  const code = weatherData.value?.current?.weatherCode
  if (code === undefined) return '🌤️'
  if (code === 0) return weatherData.value?.current?.isDay ? '☀️' : '🌙'
  if ([1, 2].includes(code)) return '🌤️'
  if (code === 3) return '☁️'
  if ([45, 48].includes(code)) return '🌫️'
  if ([51, 53, 55, 56, 57].includes(code)) return '🌦️'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️'
  if ([95, 96, 99].includes(code)) return '⛈️'
  return '🌡️'
})

// 微博/热搜
const trendingItems = ref<TrendingItem[]>([])
const trendingIndex = ref(0)
const trendingSource = ref<TrendingSource>('weibo')
const trendingUnavailable = ref(false)
let trendingTimer: number | null = null

async function fetchTrending() {
  try {
    const res = await getTrending(trendingSource.value, 15)
    if (res.code === 0 && res.data?.items?.length) {
      trendingItems.value = res.data.items
      trendingUnavailable.value = false
    }
    else {
      trendingUnavailable.value = true
    }
  }
  catch {
    trendingUnavailable.value = true
  }
}

const currentTrending = computed(() => {
  if (!trendingItems.value.length) return null
  return trendingItems.value[trendingIndex.value % trendingItems.value.length]
})

function startTrendingRoll() {
  if (trendingTimer) clearInterval(trendingTimer)
  trendingTimer = window.setInterval(() => {
    if (trendingItems.value.length > 1)
      trendingIndex.value = (trendingIndex.value + 1) % trendingItems.value.length
  }, 4000)
}

function openTrending(item: TrendingItem) {
  if (item?.url)
    runtime.openUrl(item.url, 'tab')
}

const defaultPresetGroups: DashboardGroup[] = [
  {
    id: 1,
    title: '🌟 常用推荐',
    icon: '',
    sort: 1,
    hoverStatus: false,
    items: [
      { id: 101, title: 'GitHub', url: 'https://github.com', description: '全球开源代码平台', icon: { itemType: 2, src: 'mdi:github' }, openMethod: 1, itemIconGroupId: 1 },
      { id: 102, title: 'Bilibili', url: 'https://www.bilibili.com', description: '哔哩哔哩 (゜-゜)つロ', icon: { itemType: 2, src: 'ri:bilibili-fill' }, openMethod: 1, itemIconGroupId: 1 },
      { id: 103, title: 'YouTube', url: 'https://www.youtube.com', description: '全球视频流媒体', icon: { itemType: 2, src: 'ri:youtube-fill' }, openMethod: 1, itemIconGroupId: 1 },
      { id: 104, title: 'V2EX', url: 'https://v2ex.com', description: '创意工作者社区', icon: { itemType: 2, src: 'mdi:code-tags' }, openMethod: 1, itemIconGroupId: 1 },
      { id: 105, title: 'ChatGPT', url: 'https://chatgpt.com', description: 'AI 对话与创作助手', icon: { itemType: 2, src: 'mdi:robot' }, openMethod: 1, itemIconGroupId: 1 },
      { id: 106, title: 'DeepSeek', url: 'https://chat.deepseek.com', description: '深度求索通用大模型', icon: { itemType: 2, src: 'solar:cpu-bold' }, openMethod: 1, itemIconGroupId: 1 },
    ],
  },
]

type ExtensionSyncStatus = 'idle' | 'syncing' | 'online' | 'cached' | 'offline' | 'error'
const extensionSyncStatus = ref<ExtensionSyncStatus>('syncing')
const syncRevision = ref<Sync.Revision>('0')
const groups = ref<DashboardGroup[]>(defaultPresetGroups)
let isRefreshing = false

function applyBootstrapData(data: Sync.BootstrapResponseV1) {
  const dashboard = createDashboardState(data)
  setSyncRevision(dashboard.revision)
  syncRevision.value = dashboard.revision
  const localAppearance = readExtensionAppearance()
  if (localAppearance) {
    panelState.applyPanelConfig(localAppearance)
  }
  else {
    // Use the cloud appearance only as a first-run starting point, then fork it
    // locally so later extension changes cannot overwrite the web appearance.
    panelState.applyPanelConfig(dashboard.panelConfig)
    void saveExtensionAppearance(panelState.panelConfig).catch((error) => {
      console.error('Failed to initialize extension appearance.', error)
    })
  }
  authStore.setUserInfo(dashboard.account)
  authStore.setVisitMode(VisitMode.VISIT_MODE_LOGIN)
  userStore.updateUserInfo(dashboard.account)
  refreshPendingMutationsCount()
  groups.value = dashboard.groups || []
}

async function refreshBootstrap() {
  if (isRefreshing) return
  isRefreshing = true
  extensionSyncStatus.value = 'syncing'
  try {
    const accountId = authStore.userInfo?.id
    if (accountId) {
      const result = await refreshBootstrapSnapshot(accountId)
      if (result.data) {
        applyBootstrapData(result.data)
        extensionSyncStatus.value = 'online'
        return
      }
    }
    const bootstrapRes = await getBootstrap()
    if (bootstrapRes.code === 0 && bootstrapRes.data) {
      applyBootstrapData(bootstrapRes.data)
      extensionSyncStatus.value = 'online'
      return
    }
    // 降级使用普通 API 获取
    if (!authStore.token) {
      await router.push('/login')
      return
    }
    if (await loadDirectFromApi())
      extensionSyncStatus.value = 'online'
    else
      loadCachedSnapshot()
  }
  catch {
    loadCachedSnapshot()
  }
  finally {
    isRefreshing = false
  }
}

function loadCachedSnapshot() {
  const accountId = authStore.userInfo?.id
  const cached = accountId ? readBootstrapSnapshot(accountId) : null
  if (cached?.data) {
    applyBootstrapData(cached.data)
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
        sort: g.sort ?? 0,
        hoverStatus: false,
        items: itemsRes.data,
      } satisfies DashboardGroup
  }))
  if (results.some(group => group === null))
    return false
  groups.value = results as DashboardGroup[]
  return true
}

// 5. 分组 Tab 切换与卡片过滤（告别堆叠）
const activeTabId = ref<number | null>(null)
const sidePanelOpen = ref(false)
const wheelHintVisible = ref(false)
const settingsModalVisible = ref(false)
const editCardModalVisible = ref(false)
const editCardData = ref<Panel.ItemInfo | null>(null)
const editCardGroupId = ref<number | undefined>(undefined)
const longPressActive = ref<number | null>(null)
let wheelLocked = false
let wheelHintTimer: number | null = null
let longPressTimer: number | null = null
let suppressNextCardClick = false

const groupTabs = computed(() => {
  return groups.value.map(g => ({
    id: g.id as number,
    title: g.title || '',
    count: g.items?.length || 0,
    icon: g.icon,
  }))
})

const displayedCards = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const allGroups = groups.value

  const filteredGroups = activeTabId.value === null
    ? allGroups.slice(0, 1)
    : allGroups.filter(g => g.id === activeTabId.value)

  const cards: Array<Panel.ItemInfo & { groupTitle: string; groupId: number }> = []

  for (const group of filteredGroups) {
    for (const item of group.items || []) {
      if (query) {
        const titleMatch = item.title?.toLowerCase().includes(query)
        const descMatch = item.description?.toLowerCase().includes(query)
        const urlMatch = item.url?.toLowerCase().includes(query)
        if (!titleMatch && !descMatch && !urlMatch)
          continue
      }
      cards.push({
        ...item,
        groupTitle: group.title || '',
        groupId: group.id || 0,
      })
    }
  }

  return cards
})

const activeGroup = computed(() => groupTabs.value.find(group => group.id === activeTabId.value) || groupTabs.value[0])

watch(groupTabs, (tabs) => {
  if (!tabs.length) {
    activeTabId.value = null
    return
  }
  if (!tabs.some(tab => tab.id === activeTabId.value))
    activeTabId.value = tabs[0].id
}, { immediate: true })

function selectGroup(id: number) {
  activeTabId.value = id
  sidePanelOpen.value = false
}

function handleGroupWheel(event: WheelEvent) {
  if (settingsModalVisible.value || showWallpaperModal.value || showWidgetManager.value || editCardModalVisible.value || conflictModalVisible.value)
    return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, [role="dialog"], .side-panel-scroll'))
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
  activeTabId.value = groupTabs.value[nextIndex].id
  wheelHintVisible.value = true
  wheelLocked = true
  window.setTimeout(() => { wheelLocked = false }, 420)
  if (wheelHintTimer) window.clearTimeout(wheelHintTimer)
  wheelHintTimer = window.setTimeout(() => { wheelHintVisible.value = false }, 1100)
}

// 点击卡片在浏览器新标签页打开
function handleCardClick(card: Panel.ItemInfo) {
  if (suppressNextCardClick) {
    suppressNextCardClick = false
    return
  }
  const isLan = panelState.networkMode === PanelStateNetworkModeEnum.lan
  const targetUrl = selectItemUrl(card, isLan)
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

function startCardLongPress(event: PointerEvent, card: Panel.ItemInfo) {
  if (authStore.visitMode !== VisitMode.VISIT_MODE_LOGIN)
    return
  if (event.pointerType === 'mouse' && event.button !== 0)
    return
  cancelCardLongPress()
  longPressActive.value = card.id || null
  longPressTimer = window.setTimeout(() => {
    suppressNextCardClick = true
    longPressActive.value = null
    longPressTimer = null
    openCardEditor(card)
  }, 620)
}

function cancelCardLongPress() {
  if (longPressTimer)
    window.clearTimeout(longPressTimer)
  longPressTimer = null
  longPressActive.value = null
}

// 6. 右键菜单与快捷操作
const activeRightCard = ref<Panel.ItemInfo | null>(null)
const rightMenuShow = ref(false)
const rightMenuX = ref(0)
const rightMenuY = ref(0)

const cardDropdownOptions = computed(() => {
  const options = [
    { label: '在新标签页打开', key: 'open_tab', icon: () => h(SvgIcon, { icon: 'mdi:open-in-new' }) },
    { label: '复制链接', key: 'copy_link', icon: () => h(SvgIcon, { icon: 'mdi:content-copy' }) },
  ]
  if (activeRightCard.value?.lanUrl) {
    options.push({ label: '打开内网(LAN)地址', key: 'open_lan', icon: () => h(SvgIcon, { icon: 'mdi:lan' }) })
  }
  if (authStore.visitMode === VisitMode.VISIT_MODE_LOGIN) {
    options.push({ label: '编辑此书签', key: 'edit', icon: () => h(SvgIcon, { icon: 'mdi:pencil' }) })
  }
  return options
})

function handleCardContextMenu(event: MouseEvent, card: Panel.ItemInfo) {
  event.preventDefault()
  activeRightCard.value = card
  rightMenuX.value = event.clientX
  rightMenuY.value = event.clientY
  rightMenuShow.value = true
}

async function handleRightMenuSelect(key: string) {
  rightMenuShow.value = false
  const card = activeRightCard.value
  if (!card) return

  if (key === 'open_tab') {
    handleCardClick(card)
  }
  else if (key === 'open_lan' && card.lanUrl) {
    runtime.openUrl(card.lanUrl, 'tab')
  }
  else if (key === 'copy_link') {
    const isLan = panelState.networkMode === PanelStateNetworkModeEnum.lan
    const url = selectItemUrl(card, isLan)
    if (url) {
      try {
        await navigator.clipboard.writeText(url)
        ms.success('已复制链接到剪贴板')
      }
      catch {
        ms.error('复制失败，请检查浏览器剪贴板权限')
      }
    }
  }
  else if (key === 'edit') {
    openCardEditor(card)
  }
}

// 7. 内置系统与扩展设置模态框（In-Extension Settings Modal，无需跳出）
function openSettings() {
  settingsModalVisible.value = true
}

function handleEditSuccess(updated: Panel.Info, meta: { queued: boolean } = { queued: false }) {
  editCardModalVisible.value = false
  const updatedItem = updated as Panel.ItemInfo
  for (const group of groups.value)
    group.items = (group.items || []).filter(item => item.id !== updatedItem.id)
  const targetGroup = groups.value.find(group => group.id === updatedItem.itemIconGroupId)
  if (targetGroup)
    targetGroup.items.push(updatedItem)
  // Keep the optimistic local edit visible while it waits in the durable
  // queue. A replay or remote storage update will refresh the snapshot later.
  if (!meta.queued)
    void refreshBootstrap()
}

// 切换网络模式
function toggleNetworkMode() {
  const nextMode = panelState.networkMode === PanelStateNetworkModeEnum.lan
    ? PanelStateNetworkModeEnum.wan
    : PanelStateNetworkModeEnum.lan
  panelState.setNetworkMode(nextMode)
  ms.info(nextMode === PanelStateNetworkModeEnum.lan ? '已切换至局域网 (LAN) 优先模式' : '已切换至公网 (WAN) 模式')
}

function handleBrowserOffline() {
  extensionSyncStatus.value = 'offline'
}

async function handleBrowserOnline() {
  await processPendingWidgetCleanups()
  await triggerOfflineReplay()
  await refreshBootstrap()
}

function applyExternalStorageChanges() {
  externalStorageTimer = null
  const keys = [...externalStorageKeys]
  externalStorageKeys.clear()

  if (keys.includes(EXTENSION_APPEARANCE_KEY)) {
    const appearance = readExtensionAppearance()
    if (appearance)
      panelState.applyPanelConfig(appearance)
  }
  if (keys.includes(EXTENSION_WIDGETS_KEY))
    widgetPreferences.value = readExtensionWidgets()
  if (keys.includes(EXTENSION_WIDGETS_KEY))
    loadExtensionWidgetLayout(widgetPreferences.value.contentLayout)
  if (keys.includes('panelStorage')) {
    const localPanelState = getLocalPanelState()
    panelState.$patch({
      leftSiderCollapsed: localPanelState.leftSiderCollapsed,
      rightSiderCollapsed: localPanelState.rightSiderCollapsed,
      networkMode: localPanelState.networkMode,
    })
  }
  if (keys.some(key => key.startsWith(BOOTSTRAP_SNAPSHOT_KEY_PREFIX)))
    loadCachedSnapshot()
  refreshPendingMutationsCount()
}

function handleExternalStorageChange(change: StorageChangeEvent) {
  // A server, account or store switch changes the scope of every cached key;
  // a clean reload is safer than mixing two scopes in one running tab.
  if (change.scope === 'runtime'
    || ['AUTH_TOKEN', 'userStorage'].includes(change.key)) {
    window.location.reload()
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
  updateClock()
  clockTimer = window.setInterval(updateClock, 1000)

  removeSyncConflictListener = onSyncConflict(() => {
    void triggerOfflineReplay().then(refreshBootstrap, refreshBootstrap)
  })
  removeStorageListener = runtime.storage.subscribe?.(handleExternalStorageChange) ?? null
  removeOfflineQueueListener = onOfflineQueueChanged(refreshPendingMutationsCount)
  window.addEventListener('wheel', handleGroupWheel, { passive: false })
  window.addEventListener('online', handleBrowserOnline)
  window.addEventListener('offline', handleBrowserOffline)
  window.addEventListener('pagehide', flushPendingLayoutIfDirty)
  window.addEventListener('beforeunload', flushPendingLayoutIfDirty)

  void processPendingWidgetCleanups()
  await refreshBootstrap()
  if (isDisposed) return
  await triggerOfflineReplay()
  if (isDisposed) return
  await Promise.all([fetchWeather(), fetchTrending()])
  if (isDisposed) return
  startTrendingRoll()
})

onUnmounted(() => {
  isDisposed = true
  flushPendingLayoutIfDirty()
  if (clockTimer) clearInterval(clockTimer)
  if (trendingTimer) clearInterval(trendingTimer)
  if (wheelHintTimer) clearTimeout(wheelHintTimer)
  if (longPressTimer) clearTimeout(longPressTimer)
  if (externalStorageTimer) clearTimeout(externalStorageTimer)
  removeSyncConflictListener?.()
  removeStorageListener?.()
  removeOfflineQueueListener?.()
  window.removeEventListener('wheel', handleGroupWheel)
  window.removeEventListener('online', handleBrowserOnline)
  window.removeEventListener('offline', handleBrowserOffline)
  window.removeEventListener('pagehide', flushPendingLayoutIfDirty)
  window.removeEventListener('beforeunload', flushPendingLayoutIfDirty)
})
</script>

<template>
  <div class="extension-tab-container select-none">
    <!-- 用户自定义壁纸层 -->
    <div
      v-if="panelState.panelConfig.backgroundImageSrc"
      class="bg-cover"
      :style="{
        filter: `blur(${panelState.panelConfig.backgroundBlur ?? 0}px)`,
        backgroundImage: `url(${panelState.panelConfig.backgroundImageSrc})`,
      }"
    />

    <!-- 最左侧热区：鼠标靠近屏幕边缘时展开功能区 -->
    <div class="edge-trigger" @mouseenter="sidePanelOpen = true" />
    <div class="side-rail" @mouseenter="sidePanelOpen = true">
      <button v-if="!sidePanelOpen" type="button" class="rail-avatar" title="个人中心" @click="openSettings">
        <NAvatar round :size="30" :src="authStore.userInfo?.headImage || undefined" fallback-src="/favicon.svg">
          {{ (authStore.userInfo?.name || authStore.userInfo?.username || 'U')[0].toUpperCase() }}
        </NAvatar>
      </button>
      <div class="rail-divider" />
      <button type="button" class="rail-button active" title="分组导航" @click="sidePanelOpen = !sidePanelOpen">
        <SvgIcon icon="material-symbols:folder-outline-rounded" />
      </button>
      <button type="button" class="rail-button" title="个人中心" @click="openSettings">
        <SvgIcon icon="material-symbols:account-circle" />
      </button>
      <button type="button" class="rail-button" title="壁纸设置" @click="showWallpaperModal = true">
        <SvgIcon icon="material-symbols:wallpaper" />
      </button>
      <button type="button" class="rail-button" :title="t('widgetLayout.manager.title')" @click="showWidgetManager = true">
        <SvgIcon icon="material-symbols:widgets-outline-rounded" />
      </button>
      <button
        type="button"
        class="rail-button relative"
        :title="pendingMutationsCount > 0 ? `有 ${pendingMutationsCount} 条离线修改待同步，点击管理队列` : '刷新同步'"
        @click="pendingMutationsCount > 0 ? (queueManagerVisible = true) : refreshBootstrap()"
      >
        <SvgIcon icon="material-symbols:sync" :class="{ 'animate-spin': extensionSyncStatus === 'syncing' }" />
        <span
          v-if="pendingMutationsCount > 0"
          class="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-black text-[9px] font-bold rounded-full flex items-center justify-center"
        >
          {{ pendingMutationsCount }}
        </span>
      </button>
      <div class="rail-spacer" />
      <button type="button" class="rail-button" title="系统设置" @click="openSettings">
        <SvgIcon icon="material-symbols:settings-outline-rounded" />
      </button>
    </div>

    <aside
      class="function-panel"
      :class="{ open: sidePanelOpen }"
      @mouseenter="sidePanelOpen = true"
      @mouseleave="sidePanelOpen = false"
    >
      <div class="function-panel-head">
        <div>
          <p class="function-eyebrow">
            PANEL NEXT
          </p>
          <h2>功能区</h2>
        </div>
        <button type="button" class="panel-close" aria-label="收起功能区" @click="sidePanelOpen = false">
          <SvgIcon icon="material-symbols:chevron-left-rounded" />
        </button>
      </div>

      <!-- 功能区精美封面图 Banner -->
      <div class="function-banner relative h-20 rounded-2xl overflow-hidden mb-3 shadow-md border border-white/10 group cursor-pointer shrink-0" @click="openSettings">
        <img
          :src="defaultBackground"
          alt="Banner"
          class="w-full h-full object-cover brightness-90 group-hover:scale-105 transition-transform duration-300"
        >
        <div class="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/30 to-transparent flex items-end p-2.5">
          <div class="flex items-center justify-between w-full">
            <span class="text-xs font-bold text-white tracking-wide flex items-center space-x-1">
              <SvgIcon icon="material-symbols:space-dashboard-outline" class="text-emerald-400" />
              <span>新标签页工作台</span>
            </span>
            <span class="text-[10px] text-white/80 bg-white/10 px-2 py-0.5 rounded-full backdrop-blur-sm">快捷控制</span>
          </div>
        </div>
      </div>
      <button type="button" class="profile-card" @click="openSettings">
        <NAvatar round :size="42" :src="authStore.userInfo?.headImage || undefined" fallback-src="/favicon.svg" />
        <span class="profile-copy">
          <strong>{{ authStore.userInfo?.name || authStore.userInfo?.username || '访客模式' }}</strong>
          <small>{{ authStore.token ? '配置已连接并同步' : '登录后同步个人配置' }}</small>
        </span>
        <SvgIcon icon="material-symbols:chevron-right-rounded" />
      </button>
      <div class="panel-section-title">
        <span>我的分组</span>
      </div>
      <div class="side-panel-scroll">
        <button
          v-for="(group, index) in groupTabs"
          :key="group.id"
          type="button"
          class="group-nav-item"
          :class="{ active: activeTabId === group.id }"
          @click="selectGroup(group.id)"
        >
          <span class="group-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="group-nav-copy">
            <strong>{{ group.title }}</strong>
          </span>
          <span class="group-dot" />
        </button>
      </div>
      <div class="quick-actions">
        <button type="button" class="quick-action-wide" @click="showWidgetManager = true">
          <SvgIcon icon="material-symbols:add-box-outline-rounded" />{{ t('widgetLayout.add') }}
        </button>
        <button type="button" @click="toggleNetworkMode">
          <SvgIcon :icon="panelState.networkMode === PanelStateNetworkModeEnum.lan ? 'material-symbols:lan-outline-rounded' : 'mdi:wan'" />
          {{ panelState.networkMode === PanelStateNetworkModeEnum.lan ? '局域网模式' : '公网模式' }}
        </button>
        <button type="button" @click="openSettings">
          <SvgIcon icon="material-symbols:tune-rounded" />偏好设置
        </button>
      </div>
    </aside>
    <div
      v-if="panelState.panelConfig.backgroundImageSrc"
      class="bg-overlay"
      :style="{ backgroundColor: `rgba(0,0,0,${panelState.panelConfig.backgroundMaskNumber ?? 0.35})` }"
    />

    <!-- 顶栏：极简状态与快捷控制 -->
    <header class="top-nav-bar">
      <div class="nav-left flex items-center space-x-3 pl-10">
        <div class="brand-pill flex items-center space-x-2 px-3 py-1.5 rounded-full bg-white/10 dark:bg-black/20 backdrop-blur-md border border-white/10 text-white shadow-sm">
          <img src="/favicon.svg" class="w-4 h-4 object-contain" alt="Logo">
          <span class="font-bold text-xs tracking-wider uppercase">Panel Next</span>
        </div>
        <span class="greeting-text text-xs text-white/80 font-medium hidden sm:inline-block">
          {{ greeting }}
        </span>
      </div>

      <div class="nav-right flex items-center space-x-2">
        <!-- 实时热搜条 -->
        <div
          v-if="widgetPreferences.trending && currentTrending"
          class="trending-pill hidden md:flex items-center space-x-2 px-3 py-1 rounded-full bg-white/10 dark:bg-black/20 backdrop-blur-md border border-white/10 text-white text-xs cursor-pointer hover:bg-white/20 transition-all"
          @click="openTrending(currentTrending)"
        >
          <span class="text-amber-400 font-bold">🔥 热搜</span>
          <span class="truncate max-w-[160px]">{{ currentTrending.title }}</span>
        </div>
        <button
          v-else-if="widgetPreferences.trending && trendingUnavailable"
          type="button"
          class="status-retry-pill hidden md:flex"
          title="热搜暂不可用，点击重试"
          @click="fetchTrending"
        >
          <SvgIcon icon="material-symbols:refresh-rounded" />
          <span>热搜重试</span>
        </button>

        <!-- 实时天气微胶囊 -->
        <div
          v-if="widgetPreferences.weather && weatherData"
          class="weather-pill flex items-center space-x-1.5 px-3 py-1 rounded-full bg-white/10 dark:bg-black/20 backdrop-blur-md border border-white/10 text-white text-xs cursor-pointer hover:bg-white/20 transition-all"
          :title="`${weatherData.location.name} · ${weatherData.current.temperature}°C · 湿度 ${weatherData.current.relativeHumidity}%`"
          @click="fetchWeather"
        >
          <span class="text-sm">{{ weatherEmoji }}</span>
          <span class="font-semibold">{{ Math.round(weatherData.current.temperature) }}°C</span>
          <span class="text-white/70 text-[11px] hidden sm:inline-block">{{ weatherData.location.name }}</span>
        </div>
        <button
          v-else-if="widgetPreferences.weather && weatherUnavailable"
          type="button"
          class="status-retry-pill"
          title="天气暂不可用，点击重试"
          @click="fetchWeather"
        >
          <SvgIcon icon="material-symbols:cloud-off-outline-rounded" />
          <span>天气重试</span>
        </button>

        <!-- 网络模式切换 -->
        <button
          type="button"
          class="icon-btn"
          :title="panelState.networkMode === PanelStateNetworkModeEnum.lan ? '当前: 内网(LAN)模式，点击切换' : '当前: 公网(WAN)模式，点击切换'"
          @click="toggleNetworkMode"
        >
          <SvgIcon
            :icon="panelState.networkMode === PanelStateNetworkModeEnum.lan ? 'material-symbols:lan-outline-rounded' : 'mdi:wan'"
            class="text-base text-white"
          />
        </button>

        <!-- 同步状态指示器 -->
        <button
          type="button"
          class="icon-btn"
          :title="`同步状态: ${extensionSyncStatus} · 点击重新拉取数据`"
          :disabled="extensionSyncStatus === 'syncing'"
          @click="refreshBootstrap"
        >
          <SvgIcon
            icon="material-symbols:sync"
            class="text-base text-white"
            :class="{ 'animate-spin': extensionSyncStatus === 'syncing' }"
          />
        </button>

        <!-- 壁纸库/Wallhaven -->
        <button
          type="button"
          class="icon-btn"
          title="壁纸库 (Wallhaven 4K / 个人图库)"
          @click="showWallpaperModal = true"
        >
          <SvgIcon icon="material-symbols:wallpaper" class="text-base text-white" />
        </button>

        <!-- 扩展内置设置按钮 -->
        <button
          type="button"
          class="icon-btn settings-btn"
          title="系统与扩展设置"
          @click="openSettings"
        >
          <SvgIcon icon="majesticons-applications" class="text-base text-white" />
        </button>

        <!-- 登录入口；登录后头像只保留在左侧功能栏 -->
        <button
          v-if="!authStore.userInfo"
          type="button"
          class="login-btn flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium shadow-sm transition-all"
          @click="router.push('/login')"
        >
          <SvgIcon icon="material-symbols:account-circle" class="text-sm" />
          <span>登录</span>
        </button>
      </div>
    </header>

    <!-- 核心主体区 -->
    <main class="main-content flex flex-col items-center justify-start overflow-y-auto px-4 pb-12 pt-6">
      <!-- 极简大数字时钟与日期 -->
      <section v-if="widgetPreferences.clock" class="clock-hero flex flex-col items-center mb-6 text-white text-shadow-md">
        <div class="time-display flex items-baseline font-mono font-bold tracking-tight">
          <span class="text-6xl md:text-8xl select-all font-light">{{ currentTime }}</span>
          <span class="text-xl md:text-2xl opacity-70 ml-2 font-normal">{{ currentSeconds }}</span>
        </div>
        <div class="date-display text-sm md:text-base font-normal tracking-wide opacity-90 mt-1">
          {{ currentDate }}
        </div>
      </section>

      <!-- 居中胶囊全能搜索栏 -->
      <section v-if="widgetPreferences.search" class="search-section w-full max-w-[640px] mb-8">
        <div
          class="search-bar-capsule flex items-center bg-white/20 dark:bg-black/35 backdrop-blur-xl border border-white/25 dark:border-white/10 rounded-full px-3 py-2 shadow-lg transition-all duration-300"
          :class="{ 'ring-2 ring-emerald-400/60 shadow-emerald-500/20 bg-white/30 dark:bg-black/50': isSearchFocused }"
        >
          <!-- 搜索引擎下拉切换 -->
          <NDropdown :options="engineDropdownOptions" trigger="click" @select="handleSelectEngine">
            <button
              type="button"
              class="engine-select-btn flex items-center space-x-1 pl-2 pr-2 py-1 rounded-full hover:bg-white/20 dark:hover:bg-white/10 transition-colors"
            >
              <img v-if="currentEngine.iconSrc" :src="currentEngine.iconSrc" class="w-4 h-4 object-contain" :alt="currentEngine.title">
              <SvgIcon v-else :icon="currentEngine.icon" class="w-4 h-4 text-white" />
              <SvgIcon icon="mingcute:down-small-fill" class="w-3 h-3 text-white/70" />
            </button>
          </NDropdown>

          <!-- 搜索输入框 -->
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索书签或全网 (回车搜索)..."
            class="flex-1 bg-transparent border-none outline-none text-white placeholder-white/60 px-3 text-sm md:text-base"
            @focus="isSearchFocused = true"
            @blur="isSearchFocused = false"
            @keydown.enter="handleSearchSubmit"
          >

          <!-- 清除按钮 -->
          <button
            v-if="searchQuery"
            type="button"
            class="clear-btn text-white/70 hover:text-white mr-1 p-1 rounded-full hover:bg-white/20 transition-colors"
            @click="searchQuery = ''"
          >
            <SvgIcon icon="material-symbols:close-rounded" class="w-4 h-4" />
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
      </section>

      <section
        v-if="extensionWidgetInstances.length || extensionWidgetEditMode"
        class="extension-widget-grid w-full max-w-[1280px] mb-8"
        :class="{ 'is-editing': extensionWidgetEditMode }"
      >
        <div class="extension-widget-toolbar">
          <div class="flex items-center gap-2">
            <NDropdown v-if="extensionWidgetEditMode" trigger="click" :options="extensionWidgetAddOptions" @select="addExtensionWidget">
              <button
                type="button"
                class="modal-secondary-action flex items-center gap-1"
                :title="t('widgetLayout.add')"
                :aria-label="t('widgetLayout.add')"
              >
                <SvgIcon icon="material-symbols:add-rounded" class="w-4 h-4" />
                <span>{{ t('widgetLayout.add') }}</span>
              </button>
            </NDropdown>
            <button
              type="button"
              class="modal-secondary-action flex items-center gap-1"
              :title="extensionWidgetEditMode ? t('widgetLayout.done') : t('widgetLayout.edit')"
              :aria-label="extensionWidgetEditMode ? t('widgetLayout.done') : t('widgetLayout.edit')"
              @click="extensionWidgetEditMode = !extensionWidgetEditMode"
            >
              <SvgIcon :icon="extensionWidgetEditMode ? 'material-symbols:check-rounded' : 'material-symbols:dashboard-customize-outline-rounded'" class="w-4 h-4" />
              <span>{{ extensionWidgetEditMode ? t('widgetLayout.done') : t('widgetLayout.edit') }}</span>
            </button>
          </div>
        </div>

        <div v-if="!extensionWidgetInstances.length && extensionWidgetEditMode" class="extension-widget-empty col-span-full flex flex-col items-center justify-center p-8 border border-dashed border-cyan-500/30 rounded-2xl bg-slate-900/60 text-cyan-200">
          <SvgIcon icon="material-symbols:widgets-outline-rounded" class="w-10 h-10 mb-2 opacity-60" />
          <p class="text-sm font-semibold mb-1">
            {{ t('widgetLayout.empty') }}
          </p>
          <p class="text-xs opacity-70 mb-4">
            {{ t('widgetLayout.emptyTip') }}
          </p>
          <NDropdown trigger="click" :options="extensionWidgetAddOptions" @select="addExtensionWidget">
            <button type="button" class="modal-primary-action flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs">
              <SvgIcon icon="material-symbols:add-rounded" class="w-4 h-4" />
              <span>{{ t('widgetLayout.add') }}</span>
            </button>
          </NDropdown>
        </div>

        <VueDraggable
          v-else
          v-model="extensionWidgetInstances"
          class="extension-widget-track"
          handle=".extension-widget-handle"
          :disabled="!extensionWidgetEditMode"
          :animation="150"
          @end="onExtensionWidgetDragEnd"
        >
          <div
            v-for="instance in extensionWidgetInstances"
            :key="instance.id"
            class="extension-widget-cell"
            :class="{ 'is-widget-hidden': instance.hidden }"
            :style="extensionWidgetCellStyle(instance)"
          >
            <div v-if="extensionWidgetEditMode" class="extension-widget-editor">
              <span class="extension-widget-handle" :title="t('widgetLayout.drag')" :aria-label="t('widgetLayout.drag')">
                <SvgIcon icon="material-symbols:drag-indicator" class="w-4 h-4" />
              </span>
              <span class="extension-widget-name">{{ widgetDefinitionTitle(widgetRegistry.get(instance.type) ?? { type: instance.type }) }}</span>
              <span class="extension-widget-actions">
                <button
                  type="button"
                  :title="t('widgetLayout.narrow')"
                  :aria-label="t('widgetLayout.narrow')"
                  @click="resizeExtensionWidget(instance, 'columns', -1)"
                >
                  <SvgIcon icon="material-symbols:chevron-left-rounded" class="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  :title="t('widgetLayout.widen')"
                  :aria-label="t('widgetLayout.widen')"
                  @click="resizeExtensionWidget(instance, 'columns', 1)"
                >
                  <SvgIcon icon="material-symbols:chevron-right-rounded" class="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  :title="t('widgetLayout.shrink')"
                  :aria-label="t('widgetLayout.shrink')"
                  @click="resizeExtensionWidget(instance, 'rows', -1)"
                >
                  <SvgIcon icon="material-symbols:keyboard-arrow-up-rounded" class="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  :title="t('widgetLayout.stretch')"
                  :aria-label="t('widgetLayout.stretch')"
                  @click="resizeExtensionWidget(instance, 'rows', 1)"
                >
                  <SvgIcon icon="material-symbols:keyboard-arrow-down-rounded" class="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  :title="instance.hidden ? t('widgetLayout.show') : t('widgetLayout.hide')"
                  :aria-label="instance.hidden ? t('widgetLayout.show') : t('widgetLayout.hide')"
                  @click="toggleExtensionWidgetHidden(instance)"
                >
                  <SvgIcon :icon="instance.hidden ? 'material-symbols:visibility-off-outline-rounded' : 'material-symbols:visibility-outline-rounded'" class="w-3.5 h-3.5" />
                </button>
                <button
                  v-if="hasExtensionWidgetSettings(instance)"
                  type="button"
                  :title="t('widgetLayout.configure')"
                  :aria-label="t('widgetLayout.configure')"
                  @click="openExtensionWidgetSettings(instance)"
                >
                  <SvgIcon icon="material-symbols:settings-outline-rounded" class="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  :title="t('widgetLayout.remove')"
                  :aria-label="t('widgetLayout.remove')"
                  @click="confirmRemoveExtensionWidget(extensionWidgetInstances.indexOf(instance))"
                >
                  <SvgIcon icon="material-symbols:close-rounded" class="w-3.5 h-3.5" />
                </button>
              </span>
            </div>
            <WidgetHost :instance="instance" :edit-mode="extensionWidgetEditMode" />
          </div>
        </VueDraggable>
      </section>

      <!-- 现代应用网格 (Speed Dial Grid) -->
      <section class="cards-grid-section w-full max-w-[1280px]">
        <div class="active-group-meta">
          <span>{{ activeGroup?.title }}</span>
        </div>
        <div v-if="displayedCards.length > 0" class="cards-grid">
          <div
            v-for="card in displayedCards"
            :key="card.id"
            class="speed-card group"
            :class="{ 'is-long-pressing': longPressActive === card.id }"
            :title="card.description || card.title"
            @click="handleCardClick(card)"
            @contextmenu="handleCardContextMenu($event, card)"
            @pointerdown="startCardLongPress($event, card)"
            @pointerup="cancelCardLongPress"
            @pointercancel="cancelCardLongPress"
            @pointerleave="cancelCardLongPress"
          >
            <!-- 图标容器 -->
            <div class="card-icon-box">
              <ItemIcon :item-icon="card.icon" :size="48" class="card-item-icon" />
            </div>

            <!-- 卡片标题 -->
            <div class="card-info">
              <span class="card-title">{{ card.title }}</span>
              <span v-if="card.description" class="card-desc">{{ card.description }}</span>
            </div>
          </div>
        </div>

        <!-- 无匹配结果空状态 -->
        <div v-else class="empty-state flex flex-col items-center justify-center py-16 text-white/70">
          <SvgIcon icon="material-symbols:search-off-rounded" class="w-12 h-12 text-white/40 mb-3" />
          <p class="text-sm font-medium">
            没有找到匹配的书签或服务
          </p>
          <p v-if="searchQuery" class="text-xs text-white/50 mt-1">
            按回车直接全网搜索 "{{ searchQuery }}"
          </p>
        </div>
      </section>
    </main>

    <Transition name="wheel-hint">
      <div v-if="wheelHintVisible" class="wheel-switch-hint">
        <SvgIcon icon="material-symbols:mouse-outline-rounded" />
        <span>{{ activeGroup?.title }}</span>
        <small>{{ activeGroup?.count || 0 }} 项</small>
      </div>
    </Transition>

    <!-- 右键卡片菜单 -->
    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="rightMenuX"
      :y="rightMenuY"
      :options="cardDropdownOptions"
      :show="rightMenuShow"
      :on-clickoutside="() => rightMenuShow = false"
      @select="handleRightMenuSelect"
    />

    <!-- 现代化专属个人中心与系统控制台 -->
    <UserHubModal
      v-model:show="settingsModalVisible"
      :sync-status="extensionSyncStatus"
      :sync-revision="syncRevision"
      @refresh="refreshBootstrap"
    />

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
      style="width: min(520px, calc(100vw - 24px)); border-radius: 20px; background: rgba(15, 23, 42, 0.98); border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: 0 24px 80px rgba(2, 6, 23, 0.58);"
    >
      <div class="widget-manager-content">
        <p>{{ t('widgetLayout.manager.desc') }}</p>
        <label class="widget-choice">
          <span><SvgIcon icon="material-symbols:schedule-outline-rounded" /><b>{{ t('widgetLayout.manager.clockTitle') }}</b><small>{{ t('widgetLayout.manager.clockDesc') }}</small></span>
          <NSwitch v-model:value="widgetPreferences.clock" />
        </label>
        <label class="widget-choice">
          <span><SvgIcon icon="material-symbols:search-rounded" /><b>{{ t('widgetLayout.manager.searchTitle') }}</b><small>{{ t('widgetLayout.manager.searchDesc') }}</small></span>
          <NSwitch v-model:value="widgetPreferences.search" />
        </label>
        <label class="widget-choice">
          <span><SvgIcon icon="material-symbols:partly-cloudy-day-outline" /><b>{{ t('widgetLayout.manager.weatherTitle') }}</b><small>{{ t('widgetLayout.manager.weatherDesc') }}</small></span>
          <NSwitch v-model:value="widgetPreferences.weather" />
        </label>
        <label class="widget-choice">
          <span><SvgIcon icon="material-symbols:local-fire-department-outline-rounded" /><b>{{ t('widgetLayout.manager.trendingTitle') }}</b><small>{{ t('widgetLayout.manager.trendingDesc') }}</small></span>
          <NSwitch v-model:value="widgetPreferences.trending" />
        </label>
        <div class="extension-widget-library">
          <div class="extension-widget-library-head">
            <div><b>{{ t('widgetLayout.manager.contentWidgetsTitle') }}</b><small>{{ t('widgetLayout.manager.contentWidgetsDesc') }}</small></div>
            <NDropdown trigger="click" :options="extensionWidgetAddOptions" @select="addExtensionWidget">
              <button type="button" class="modal-secondary-action">
                {{ t('widgetLayout.add') }}
              </button>
            </NDropdown>
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

    <WidgetSettingsModal v-model:show="extensionWidgetSettingsVisible" :instance="extensionWidgetSettingsInstance" @save="applyExtensionWidgetSettings" />

    <!-- 壁纸库 / Wallhaven 选择弹窗 -->
    <NModal
      v-model:show="showWallpaperModal"
      preset="card"
      title="高清壁纸库 (Wallhaven 4K / 图库)"
      class="wallpaper-manager-modal extension-surface-modal"
      style="width: min(960px, calc(100vw - 24px)); height: min(680px, calc(100vh - 24px)); border-radius: 20px; background: rgba(15, 23, 42, 0.98); border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: 0 24px 80px rgba(2, 6, 23, 0.58);"
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
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: #f8fafc;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background-color: #0b0f19;
  background-image:
    radial-gradient(at 10% 10%, rgba(37, 99, 235, 0.35) 0px, transparent 50%),
    radial-gradient(at 90% 15%, rgba(139, 92, 246, 0.35) 0px, transparent 50%),
    radial-gradient(at 50% 90%, rgba(16, 185, 129, 0.28) 0px, transparent 50%),
    linear-gradient(180deg, #090d16 0%, #0f172a 100%);
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
}

.side-rail {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 40;
  width: 54px;
  padding: 20px 9px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: rgba(8, 13, 24, 0.56);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(22px) saturate(135%);
  box-shadow: 8px 0 30px rgba(0, 0, 0, 0.12);
}

.rail-avatar,
.rail-button,
.panel-close {
  display: grid;
  place-items: center;
  border: 0;
  color: rgba(255, 255, 255, 0.68);
  cursor: pointer;
}

.rail-avatar {
  padding: 0;
  border-radius: 50%;
  background: transparent;
}

.rail-divider {
  width: 24px;
  height: 1px;
  margin: 3px 0 7px;
  background: rgba(255, 255, 255, 0.14);
}

.rail-button {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: transparent;
  font-size: 18px;
  transition: 180ms ease;
}

.rail-button:hover,
.rail-button.active {
  color: white;
  background: rgba(255, 255, 255, 0.14);
}

.rail-button.active::before {
  content: '';
  position: absolute;
  left: 0;
  width: 3px;
  height: 20px;
  border-radius: 0 3px 3px 0;
  background: #67e8f9;
}

.rail-spacer { flex: 1; }

.function-panel {
  position: fixed;
  inset: 0 auto 0 54px;
  z-index: 39;
  width: min(330px, calc(100vw - 54px));
  padding: 26px 20px 20px;
  display: flex;
  flex-direction: column;
  color: white;
  background: linear-gradient(145deg, rgba(10, 17, 31, 0.95), rgba(15, 23, 42, 0.82));
  border-right: 1px solid rgba(255, 255, 255, 0.13);
  backdrop-filter: blur(34px) saturate(140%);
  box-shadow: 20px 0 60px rgba(0, 0, 0, 0.34);
  transform: translateX(calc(-100% - 18px));
  opacity: 0;
  pointer-events: none;
  transition: transform 260ms cubic-bezier(.2,.8,.2,1), opacity 200ms ease;
}

.function-panel.open {
  transform: translateX(0);
  opacity: 1;
  pointer-events: auto;
}

.function-panel-head,
.panel-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.function-eyebrow {
  margin: 0 0 2px;
  color: #67e8f9;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .2em;
}

.function-panel h2 { margin: 0; font-size: 24px; font-weight: 720; }
.panel-close { width: 34px; height: 34px; border-radius: 10px; background: rgba(255,255,255,.08); font-size: 20px; }

.profile-card {
  width: 100%;
  margin: 24px 0 26px;
  padding: 13px;
  display: flex;
  align-items: center;
  gap: 11px;
  text-align: left;
  color: white;
  border: 1px solid rgba(255,255,255,.11);
  border-radius: 17px;
  background: linear-gradient(135deg, rgba(255,255,255,.11), rgba(255,255,255,.04));
  cursor: pointer;
}

.profile-copy,
.group-nav-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.profile-copy strong { font-size: 13px; }
.profile-copy small { margin-top: 2px; color: rgba(255,255,255,.5); font-size: 10px; }
.panel-section-title { padding: 0 4px 9px; font-size: 12px; font-weight: 700; }
.panel-section-title small { color: rgba(255,255,255,.38); font-size: 10px; font-weight: 500; }
.side-panel-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 3px 3px 12px; scrollbar-width: none; }
.side-panel-scroll::-webkit-scrollbar { display: none; }

.group-nav-item {
  width: 100%;
  padding: 11px 10px;
  display: flex;
  align-items: center;
  gap: 11px;
  color: rgba(255,255,255,.7);
  text-align: left;
  border: 1px solid transparent;
  border-radius: 13px;
  background: transparent;
  cursor: pointer;
  transition: 180ms ease;
}

.group-nav-item:hover { color: white; background: rgba(255,255,255,.07); }
.group-nav-item.active { color: white; border-color: rgba(103,232,249,.22); background: rgba(103,232,249,.1); }
.group-number { color: rgba(255,255,255,.32); font: 10px/1 ui-monospace, monospace; }
.group-nav-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.group-nav-copy small { margin-top: 2px; color: rgba(255,255,255,.4); font-size: 9px; }
.group-dot { width: 5px; height: 5px; border-radius: 50%; background: transparent; }
.group-nav-item.active .group-dot { background: #67e8f9; box-shadow: 0 0 10px #22d3ee; }

.quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.09); }
.quick-actions button { padding: 9px 6px; display: flex; align-items: center; justify-content: center; gap: 5px; color: rgba(255,255,255,.65); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.04); font-size: 10px; cursor: pointer; }
.quick-actions button:hover { color: white; background: rgba(255,255,255,.1); }
.quick-actions .quick-action-wide { grid-column: 1 / -1; color: #a5f3fc; border-color: rgba(103,232,249,.2); background: rgba(34,211,238,.08); }

/* 顶部导航栏 */
.top-nav-bar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  width: 100%;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(16px);
  cursor: pointer;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.status-retry-pill {
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  color: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(14px);
  font-size: 11px;
  cursor: pointer;
}

.status-retry-pill:hover {
  color: white;
  background: rgba(255, 255, 255, 0.16);
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.32);
  border-color: rgba(255, 255, 255, 0.45);
  transform: translateY(-2px) scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}

.icon-btn:active {
  transform: translateY(0) scale(0.98);
}

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

/* 卡片栅格 */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 16px;
  padding: 8px;
}

@media (min-width: 768px) {
  .cards-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 20px;
  }
}

/* 单个 Speed Card */
.speed-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 10px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(16px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  text-align: center;
}

.speed-card:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
}

.speed-card.is-long-pressing {
  transform: scale(.96);
  border-color: rgba(103, 232, 249, .7);
  box-shadow: 0 0 0 3px rgba(34, 211, 238, .18);
}

.extension-widget-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-flow: dense;
  grid-auto-rows: minmax(72px, auto);
  gap: 14px;
  padding: 8px;
}
.extension-widget-cell { min-width: 0; min-height: 0; }
.extension-widget-cell.is-widget-hidden { display: none; }
.extension-widget-grid.is-editing .is-widget-hidden { display: block; opacity: 0.4; }
.extension-widget-toolbar { display: flex; justify-content: flex-end; grid-column: 1 / -1; }
.extension-widget-track { display: contents; }
.extension-widget-editor { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; padding: 5px 8px; border: 1px dashed rgba(103,232,249,.35); border-radius: 10px; background: rgba(15,23,42,.78); font-size: 11px; color: #a5f3fc; cursor: default; }
.extension-widget-handle { cursor: grab; padding: 0 2px; font-size: 13px; color: #67e8f9; user-select: none; display: inline-flex; align-items: center; justify-content: center; }
.extension-widget-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.extension-widget-actions { display: flex; align-items: center; gap: 4px; }
.extension-widget-actions button {
  min-width: 28px;
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
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease;
  touch-action: manipulation;
}
.extension-widget-actions button:hover { border-color: rgba(103,232,249,.6); background: rgba(30,41,59,.95); }
.extension-widget-actions button:focus-visible,
.extension-widget-list-item button:focus-visible,
.modal-secondary-action:focus-visible,
.modal-primary-action:focus-visible {
  outline: 2px solid #67e8f9;
  outline-offset: 2px;
}

@media (pointer: coarse), (max-width: 720px) {
  .extension-widget-grid { grid-template-columns: 1fr; }
  .extension-widget-cell { grid-column: 1 / -1 !important; }
  .extension-widget-actions { flex-wrap: wrap; }
  .extension-widget-actions button { min-width: 44px; height: 44px; padding: 0 8px; }
  .extension-widget-editor { min-height: 48px; padding: 6px 10px; }
  .extension-widget-handle { min-width: 32px; min-height: 32px; }
  .modal-secondary-action { min-height: 44px; padding: 10px 14px; }
  .extension-widget-list-item button { min-height: 44px; min-width: 44px; padding: 10px 12px; }
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
:global(.wallpaper-manager-modal .n-card__content) { height: calc(100% - 59px); padding: 0; overflow: hidden; }


.card-icon-box {
  width: 58px;
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  margin-bottom: 8px;
  overflow: hidden;
  transition: transform 0.25s ease;
}

.speed-card:hover .card-icon-box {
  transform: scale(1.06);
}

.card-info {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

.card-desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.65);
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

@media (max-width: 700px) {
  .side-rail { width: 46px; padding-inline: 5px; }
  .function-panel { left: 46px; width: calc(100vw - 46px); }
  .top-nav-bar { padding: 10px 12px; }
  .nav-left { display: none; }
  .nav-right { width: 100%; justify-content: flex-end; }
  .main-content { padding-left: 54px; }
  .clock-hero { margin-top: 20px; }
  .active-group-meta small { display: none; }
  .cards-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .speed-card { padding: 10px 5px; }
  .card-desc { display: none; }
  :global(.extension-surface-modal .n-card-header) { padding: 14px 16px; }
  :global(.wallpaper-manager-modal .n-card__content) { height: calc(100% - 53px); }
}
</style>
