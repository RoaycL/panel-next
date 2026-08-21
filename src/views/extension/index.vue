<script setup lang="ts">
import { computed, defineAsyncComponent, h, onMounted, onUnmounted, ref } from 'vue'
import {
  NAvatar,
  NDropdown,
  NModal,
  useMessage,
} from 'naive-ui'
import { useRouter } from 'vue-router'
import { SvgIcon, ItemIcon } from '@/components/common'
import { useAuthStore, usePanelState, useUserStore } from '@/store'
import { PanelStateNetworkModeEnum } from '@/enums'
import { VisitMode } from '@/enums/auth'
import { getRuntime } from '@/runtime'
import { readBootstrapSnapshot, refreshBootstrapSnapshot } from '@/sync/bootstrapCache'
import { onSyncConflict, setSyncRevision } from '@/sync/revision'
import { getBootstrap } from '@/api/sync'
import { getList as getGroupList } from '@/api/panel/itemIconGroup'
import { getListByGroupId } from '@/api/panel/itemIcon'
import type { DashboardGroup } from '@/dashboard/core'
import { createDashboardState, selectItemUrl } from '@/dashboard/core'
import { getWeather, type WeatherResponse } from '@/api/weather'
import { getTrending, type TrendingItem, type TrendingSource } from '@/api/trending'

import SvgSrcBaidu from '@/assets/search_engine_svg/baidu.svg'
import SvgSrcBing from '@/assets/search_engine_svg/bing.svg'
import SvgSrcGoogle from '@/assets/search_engine_svg/google.svg'

const AppStarter = defineAsyncComponent(() => import('@/views/home/components/AppStarter/index.vue'))
const EditItem = defineAsyncComponent(() => import('@/views/home/components/EditItem/index.vue'))
const GallerySelector = defineAsyncComponent(() => import('@/components/common/GallerySelector/index.vue'))

const router = useRouter()
const ms = useMessage()
const panelState = usePanelState()
const authStore = useAuthStore()
const userStore = useUserStore()
const runtime = getRuntime()

const showWallpaperModal = ref(false)

function handleWallpaperSelect(url: string) {
  panelState.panelConfig.backgroundImageSrc = url
  showWallpaperModal.value = false
  ms.success('已切换背景壁纸')
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

async function fetchWeather() {
  try {
    const res = await getWeather(weatherCity.value, 'metric')
    if (res.code === 0)
      weatherData.value = res.data
  }
  catch {
    // ignore
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
let trendingTimer: number | null = null

async function fetchTrending() {
  try {
    const res = await getTrending(trendingSource.value, 15)
    if (res.code === 0 && res.data?.items?.length)
      trendingItems.value = res.data.items
  }
  catch {
    // ignore
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

// 4. 数据同步与状态
type ExtensionSyncStatus = 'idle' | 'syncing' | 'online' | 'cached' | 'offline' | 'error'
const extensionSyncStatus = ref<ExtensionSyncStatus>('syncing')
const groups = ref<DashboardGroup[]>([])
let isRefreshing = false

function applyBootstrapData(data: Sync.BootstrapResponseV1) {
  const dashboard = createDashboardState(data)
  setSyncRevision(dashboard.revision)
  panelState.applyPanelConfig(dashboard.panelConfig)
  authStore.setUserInfo(dashboard.account)
  authStore.setVisitMode(VisitMode.VISIT_MODE_LOGIN)
  userStore.updateUserInfo(dashboard.account)
  groups.value = dashboard.groups
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
    await loadDirectFromApi()
    extensionSyncStatus.value = 'online'
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
  if (groupRes.code === 0 && Array.isArray(groupRes.data)) {
    const groupList = groupRes.data
    const loadedGroups: DashboardGroup[] = []
    for (const g of groupList) {
      const itemsRes = await getListByGroupId<Panel.ItemInfo[]>(g.id)
      loadedGroups.push({
        id: g.id ?? 0,
        title: g.title ?? '',
        icon: g.icon,
        sort: g.sort ?? 0,
        hoverStatus: false,
        items: itemsRes.code === 0 && Array.isArray(itemsRes.data) ? itemsRes.data : [],
      })
    }
    groups.value = loadedGroups
  }
}

// 5. 分组 Tab 切换与卡片过滤（告别堆叠）
const activeTabId = ref<number | 'all'>('all')

const groupTabs = computed(() => {
  return groups.value.map(g => ({
    id: g.id as number,
    title: g.title || '',
    count: g.items?.length || 0,
    icon: g.icon,
  }))
})

const totalCardsCount = computed(() => {
  return groups.value.reduce((acc, g) => acc + (g.items?.length || 0), 0)
})

const displayedCards = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const allGroups = groups.value

  let filteredGroups = allGroups
  if (activeTabId.value !== 'all')
    filteredGroups = allGroups.filter(g => g.id === activeTabId.value)

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

// 点击卡片在浏览器新标签页打开
function handleCardClick(card: Panel.ItemInfo) {
  const targetUrl = selectItemUrl(card, panelState.networkMode)
  if (targetUrl)
    runtime.openUrl(targetUrl, 'tab')
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

function handleRightMenuSelect(key: string) {
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
    const url = selectItemUrl(card, panelState.networkMode)
    if (url) {
      navigator.clipboard.writeText(url)
      ms.success('已复制链接到剪贴板')
    }
  }
  else if (key === 'edit') {
    editCardData.value = card
    editCardGroupId.value = card.itemIconGroupId || 0
    editCardModalVisible.value = true
  }
}

// 7. 内置系统与扩展设置模态框（In-Extension Settings Modal，无需跳出）
const settingsModalVisible = ref(false)
const editCardModalVisible = ref(false)
const editCardData = ref<Panel.ItemInfo | null>(null)
const editCardGroupId = ref<number | undefined>(undefined)

function openSettings() {
  settingsModalVisible.value = true
}

function handleEditSuccess() {
  editCardModalVisible.value = false
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

// 8. 周期与初始化
onMounted(async () => {
  updateClock()
  clockTimer = window.setInterval(updateClock, 1000)

  onSyncConflict(() => {
    void refreshBootstrap()
  })

  await refreshBootstrap()
  await Promise.all([fetchWeather(), fetchTrending()])
  startTrendingRoll()
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  if (trendingTimer) clearInterval(trendingTimer)
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
    <div
      v-if="panelState.panelConfig.backgroundImageSrc"
      class="bg-overlay"
      :style="{ backgroundColor: `rgba(0,0,0,${panelState.panelConfig.backgroundMaskNumber ?? 0.35})` }"
    />

    <!-- 顶栏：极简状态与快捷控制 -->
    <header class="top-nav-bar">
      <div class="nav-left flex items-center space-x-3">
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
          v-if="currentTrending"
          class="trending-pill hidden md:flex items-center space-x-2 px-3 py-1 rounded-full bg-white/10 dark:bg-black/20 backdrop-blur-md border border-white/10 text-white text-xs cursor-pointer hover:bg-white/20 transition-all"
          @click="openTrending(currentTrending)"
        >
          <span class="text-amber-400 font-bold">🔥 热搜</span>
          <span class="truncate max-w-[160px]">{{ currentTrending.title }}</span>
        </div>

        <!-- 实时天气微胶囊 -->
        <div
          v-if="weatherData"
          class="weather-pill flex items-center space-x-1.5 px-3 py-1 rounded-full bg-white/10 dark:bg-black/20 backdrop-blur-md border border-white/10 text-white text-xs cursor-pointer hover:bg-white/20 transition-all"
          :title="`${weatherData.location.name} · ${weatherData.current.temperature}°C · 湿度 ${weatherData.current.relativeHumidity}%`"
          @click="fetchWeather"
        >
          <span class="text-sm">{{ weatherEmoji }}</span>
          <span class="font-semibold">{{ Math.round(weatherData.current.temperature) }}°C</span>
          <span class="text-white/70 text-[11px] hidden sm:inline-block">{{ weatherData.location.name }}</span>
        </div>

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

        <!-- 用户登录/头像 -->
        <div v-if="authStore.userInfo" class="user-avatar-wrap" @click="openSettings">
          <NAvatar
            round
            size="small"
            :src="authStore.userInfo.headImage || undefined"
            fallback-src="/favicon.svg"
            class="cursor-pointer border border-white/30 hover:scale-105 transition-transform"
          >
            {{ (authStore.userInfo.name || authStore.userInfo.username || 'U')[0].toUpperCase() }}
          </NAvatar>
        </div>
        <button
          v-else
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
      <section class="clock-hero flex flex-col items-center mb-6 text-white text-shadow-md">
        <div class="time-display flex items-baseline font-mono font-bold tracking-tight">
          <span class="text-6xl md:text-8xl select-all font-light">{{ currentTime }}</span>
          <span class="text-xl md:text-2xl opacity-70 ml-2 font-normal">{{ currentSeconds }}</span>
        </div>
        <div class="date-display text-sm md:text-base font-normal tracking-wide opacity-90 mt-1">
          {{ currentDate }}
        </div>
      </section>

      <!-- 居中胶囊全能搜索栏 -->
      <section class="search-section w-full max-w-[640px] mb-8">
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

      <!-- 分类 Tab 选项卡导航栏 —— 解决堆叠的核心！ -->
      <section class="tab-filter-bar flex items-center justify-center space-x-2 mb-6 flex-wrap gap-y-2">
        <button
          type="button"
          class="tab-pill"
          :class="{ active: activeTabId === 'all' }"
          @click="activeTabId = 'all'"
        >
          <span class="tab-icon">🌟</span>
          <span class="tab-label">全部</span>
          <span class="tab-badge">{{ totalCardsCount }}</span>
        </button>

        <button
          v-for="group in groupTabs"
          :key="group.id"
          type="button"
          class="tab-pill"
          :class="{ active: activeTabId === group.id }"
          @click="activeTabId = group.id"
        >
          <span v-if="group.icon" class="tab-icon">{{ group.icon }}</span>
          <span class="tab-label">{{ group.title }}</span>
          <span class="tab-badge">{{ group.count }}</span>
        </button>
      </section>

      <!-- 现代应用网格 (Speed Dial Grid) -->
      <section class="cards-grid-section w-full max-w-[1280px]">
        <div v-if="displayedCards.length > 0" class="cards-grid">
          <div
            v-for="card in displayedCards"
            :key="card.id"
            class="speed-card group"
            :title="card.description || card.title"
            @click="handleCardClick(card)"
            @contextmenu="handleCardContextMenu($event, card)"
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
          <p class="text-sm font-medium">没有找到匹配的书签或服务</p>
          <p v-if="searchQuery" class="text-xs text-white/50 mt-1">按回车直接全网搜索 "{{ searchQuery }}"</p>
        </div>
      </section>
    </main>

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

    <!-- 内置系统与扩展设置模态框（直接在扩展内完成设置，无需跳出） -->
    <AppStarter
      v-if="settingsModalVisible"
      v-model:visible="settingsModalVisible"
    />

    <!-- 编辑卡片弹窗 -->
    <EditItem
      v-if="editCardModalVisible"
      v-model:visible="editCardModalVisible"
      :item-info="editCardData"
      :item-group-id="editCardGroupId"
      @done="handleEditSuccess"
    />

    <!-- 壁纸库 / Wallhaven 选择弹窗 -->
    <NModal
      v-model:show="showWallpaperModal"
      preset="card"
      title="高清壁纸库 (Wallhaven 4K / 图库)"
      style="max-width: 960px; height: 680px; border-radius: 16px;"
      size="small"
      role="dialog"
      aria-modal="true"
    >
      <GallerySelector type="wallpaper" @select="handleWallpaperSelect" />
    </NModal>
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

/* Tab 药丸栏 */
.tab-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(16px);
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.tab-pill:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  transform: translateY(-1px);
}

.tab-pill.active {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.85), rgba(5, 150, 105, 0.95));
  border-color: rgba(52, 211, 153, 0.4);
  color: #fff;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 6px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.2);
  font-size: 11px;
  opacity: 0.85;
}

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
</style>
