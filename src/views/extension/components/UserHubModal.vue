<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import {
  NAvatar,
  NButton,
  NDivider,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSpin,
  NSwitch,
  useMessage,
} from 'naive-ui'
import { useAuthStore, usePanelState } from '@/store/modules'
import { getRuntime } from '@/runtime'
import { saveExtensionAppearance } from '@/runtime/extensionAppearance'
import { enqueueAppearanceSave } from '@/themes/appearanceSaveQueue'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import { logout } from '@/api'

const props = defineProps<{
  show: boolean
  syncStatus: 'idle' | 'syncing' | 'online' | 'cached' | 'offline' | 'error'
  syncRevision: Sync.Revision
  sidebarPosition: 'left' | 'right'
  sidebarAutoHide: boolean
  sidebarWheelSwitch: boolean
  sidebarDensity: 'compact' | 'comfortable'
  clockEnabled: boolean
  clockSeconds: boolean
  clockDate: boolean
  clockHourCycle: '12' | '24'
  searchEnabled: boolean
  searchEngineId: string
  searchOpenMode: 'current' | 'tab'
  searchHistoryEnabled: boolean
  searchHistoryCount: number
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'refresh'): void
  (e: 'update:sidebarPosition', value: 'left' | 'right'): void
  (e: 'update:sidebarAutoHide', value: boolean): void
  (e: 'update:sidebarWheelSwitch', value: boolean): void
  (e: 'update:sidebarDensity', value: 'compact' | 'comfortable'): void
  (e: 'update:clockEnabled', value: boolean): void
  (e: 'update:clockSeconds', value: boolean): void
  (e: 'update:clockDate', value: boolean): void
  (e: 'update:clockHourCycle', value: '12' | '24'): void
  (e: 'update:searchEnabled', value: boolean): void
  (e: 'update:searchEngineId', value: string): void
  (e: 'update:searchOpenMode', value: 'current' | 'tab'): void
  (e: 'update:searchHistoryEnabled', value: boolean): void
  (e: 'clearSearchHistory'): void
  (e: 'openWallpaper'): void
  (e: 'openWidgetManager'): void
  (e: 'openSyncQueue'): void
}>()

const authStore = useAuthStore()
const ms = useMessage()
const runtime = getRuntime()
const profileName = computed(() => authStore.userInfo?.name?.trim() || authStore.userInfo?.username?.trim() || '访客模式')
// 账号栏以登录用户名(username)为准；与 UserInfo/extension 等入口保持一致。
// mail 属于 legacy 邮箱字段，优先取 mail 会掩盖真实的登录账号（如 username=changan、mail=admin@sun.cc）。
const profileAccount = computed(() => authStore.userInfo?.username?.trim() || authStore.userInfo?.mail?.trim() || '点击头像登录')
// 身份卡只保留一个用户名：昵称即主标识。
// 当账号(登录用户名)与昵称不同才额外显示「账号：xxx」；相同时不重复，改为显示邮箱(紧跟昵称)，避免「changan/changan」两个同字用户名并排。
const identitySubtitle = computed(() => {
  if (!authStore.token)
    return '未登录 · 访客模式'
  const name = profileName.value
  const account = profileAccount.value
  if (account && account !== name)
    return `账号：${account}`
  return authStore.userInfo?.mail?.trim() || '未绑定邮箱'
})
const profileAvatarUrl = computed(() => runtime.resolveUrl(authStore.userInfo?.headImage?.trim() || ''))

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})
const sidebarPositionModel = computed({
  get: () => props.sidebarPosition,
  set: (value: 'left' | 'right') => emit('update:sidebarPosition', value),
})
const sidebarAutoHideModel = computed({
  get: () => props.sidebarAutoHide,
  set: (value: boolean) => emit('update:sidebarAutoHide', value),
})
const sidebarWheelSwitchModel = computed({
  get: () => props.sidebarWheelSwitch,
  set: (value: boolean) => emit('update:sidebarWheelSwitch', value),
})
const sidebarDensityModel = computed({
  get: () => props.sidebarDensity,
  set: (value: 'compact' | 'comfortable') => emit('update:sidebarDensity', value),
})
const clockEnabledModel = computed({
  get: () => props.clockEnabled,
  set: (value: boolean) => emit('update:clockEnabled', value),
})
const clockSecondsModel = computed({
  get: () => props.clockSeconds,
  set: (value: boolean) => emit('update:clockSeconds', value),
})
const clockDateModel = computed({
  get: () => props.clockDate,
  set: (value: boolean) => emit('update:clockDate', value),
})
const clockHourCycleModel = computed({
  get: () => props.clockHourCycle,
  set: (value: '12' | '24') => emit('update:clockHourCycle', value),
})
const searchEnabledModel = computed({
  get: () => props.searchEnabled,
  set: (value: boolean) => emit('update:searchEnabled', value),
})
const searchEngineIdModel = computed({
  get: () => props.searchEngineId,
  set: (value: string) => emit('update:searchEngineId', value),
})
const searchOpenModeModel = computed({
  get: () => props.searchOpenMode,
  set: (value: 'current' | 'tab') => emit('update:searchOpenMode', value),
})
const searchHistoryEnabledModel = computed({
  get: () => props.searchHistoryEnabled,
  set: (value: boolean) => emit('update:searchHistoryEnabled', value),
})
const sidebarPositionOptions = [
  { label: '左侧', value: 'left' },
  { label: '右侧', value: 'right' },
]
const searchEngineOptions = [
  { label: '百度', value: 'baidu' },
  { label: 'Google', value: 'google' },
  { label: 'Bing', value: 'bing' },
  { label: 'GitHub', value: 'github' },
  { label: 'Bilibili', value: 'bilibili' },
  { label: 'DuckDuckGo', value: 'duckduckgo' },
]
const searchOpenModeOptions = [
  { label: '新标签页', value: 'tab' },
  { label: '当前页面', value: 'current' },
]
const hourCycleOptions = [
  { label: '24 小时制', value: '24' },
  { label: '12 小时制', value: '12' },
]
const sidebarDensityOptions = [
  { label: '舒适', value: 'comfortable' },
  { label: '紧凑', value: 'compact' },
]

// 异步加载管理模块
const UploadFileManagerApp = defineAsyncComponent(() => import('@/components/apps/UploadFileManager/index.vue'))
const DockerManagerApp = defineAsyncComponent(() => import('@/components/apps/DockerManager/index.vue'))
const SiteSettingApp = defineAsyncComponent(() => import('@/components/apps/SiteSetting/index.vue'))
const UserInfoApp = defineAsyncComponent(() => import('@/components/apps/UserInfo/index.vue'))
const UserSessionsApp = defineAsyncComponent(() => import('@/components/apps/UserSessions/index.vue'))
const AboutApp = defineAsyncComponent(() => import('@/components/apps/About/index.vue'))
const BackupRestoreApp = defineAsyncComponent(() => import('@/components/apps/BackupRestore/index.vue'))
const ImportExportApp = defineAsyncComponent(() => import('@/components/apps/ImportExport/index.vue'))
const ThemeSettingsModal = defineAsyncComponent(() => import('@/themes/ThemeSettingsModal.vue'))

type NavKey = 'profile' | 'search' | 'time' | 'style' | 'layout' | 'sidebar' | 'gallery' | 'backup' | 'docker' | 'system' | 'server' | 'about'
const currentTab = ref<NavKey>('profile')

// 主题中心（Theme SDK）：预览不落盘，确认后才写入本地外观。
const themeCenterVisible = ref(false)
const panelStore = usePanelState()
const panelConfig = computed(() => panelStore.panelConfig)

async function onThemeSaved(selection: import('@/themes').ThemeSelection) {
  const previousConfig = JSON.parse(JSON.stringify(panelStore.panelConfig)) as Panel.panelConfig
  panelStore.panelConfig = { ...panelStore.panelConfig, theme: selection }
  try {
    await enqueueAppearanceSave(() => saveExtensionAppearance(panelStore.panelConfig))
    ms.success('主题已应用到扩展页面')
  }
  catch (error) {
    panelStore.applyPanelConfig(previousConfig)
    ms.error('主题保存失败，已恢复原设置')
    console.error('Failed to save extension theme selection.', error)
  }
}

function openWallpaperSettings() {
  visible.value = false
  emit('openWallpaper')
}

function openWidgetManager() {
  visible.value = false
  emit('openWidgetManager')
}

// 服务器配置状态
const serverInput = ref(runtime.getServerOrigin() || 'https://next.roayc.com')
const serverTesting = ref(false)
const serverTestStatus = ref<'idle' | 'success' | 'error'>('idle')
const serverTestMessage = ref('')

const connectionState = computed(() => {
  const states = {
    idle: { label: '等待同步', online: false },
    syncing: { label: '正在同步', online: true },
    online: { label: '在线同步', online: true },
    cached: { label: '使用缓存', online: navigator.onLine },
    offline: { label: '当前离线', online: false },
    error: { label: '连接异常', online: false },
  }
  return states[props.syncStatus]
})

// 导航项定义（已移除所有 badge 标签描述）
const navItems = computed(() => {
  const items = [
    {
      key: 'profile' as NavKey,
      label: '个人中心',
      desc: '账号资料、安全与多端设备会话',
      icon: 'material-symbols:account-circle',
      color: '#38bdf8',
    },
    {
      key: 'search' as NavKey,
      label: '搜索栏',
      desc: '控制扩展搜索框是否显示',
      icon: 'material-symbols:search-rounded',
      color: '#38bdf8',
    },
    {
      key: 'time' as NavKey,
      label: '时间与日期',
      desc: '控制桌面时钟和日期显示',
      icon: 'material-symbols:routine-outline-rounded',
      color: '#60a5fa',
    },
    {
      key: 'style' as NavKey,
      label: '主题与壁纸',
      desc: '主题 Token、图标包与桌面背景',
      icon: 'ion:color-palette-outline',
      color: '#a855f7',
    },
    {
      key: 'layout' as NavKey,
      label: '小组件与布局',
      desc: '添加、编辑、缩放和叠放组件',
      icon: 'majesticons-applications',
      color: '#22d3ee',
    },
    {
      key: 'sidebar' as NavKey,
      label: '侧边栏',
      desc: '位置、自动隐藏与分组导航',
      icon: 'tabler:layout-sidebar-left-collapse-filled',
      color: '#34d399',
    },
    {
      key: 'gallery' as NavKey,
      label: '图库素材中心',
      desc: '管理个人壁纸、应用图标与图床',
      icon: 'mdi:image-multiple-outline',
      color: '#ec4899',
    },
    {
      key: 'backup' as NavKey,
      label: '备份与恢复',
      desc: '导入导出、云端备份与同步队列',
      icon: 'icon-park-outline:import-and-export',
      color: '#2dd4bf',
    },
    {
      key: 'docker' as NavKey,
      label: 'Docker 容器管理',
      desc: '服务器容器监控、启停与控制',
      icon: 'mdi:docker',
      color: '#0284c7',
    },
    {
      key: 'system' as NavKey,
      label: '系统与站点配置',
      desc: '管理员站点基础信息与服务设置',
      icon: 'majesticons-applications',
      color: '#8b5cf6',
    },
    {
      key: 'server' as NavKey,
      label: '服务器节点连接',
      desc: '配置 Panel Next 服务端同步端点',
      icon: 'mdi:web',
      color: '#10b981',
    },
    {
      key: 'about' as NavKey,
      label: '关于与版本信息',
      desc: '版本更新、开发团队与项目信息',
      icon: 'lucide-info',
      color: '#64748b',
    },
  ]
  return authStore.userInfo?.role === 1
    ? items
    : items.filter(item => item.key !== 'docker' && item.key !== 'system')
})
const selectedNavItem = computed(() => navItems.value.find(item => item.key === currentTab.value) ?? navItems.value[0])

// 快捷测试/保存服务器地址
async function handleSaveServer() {
  serverTesting.value = true
  serverTestStatus.value = 'idle'
  serverTestMessage.value = ''
  try {
    const previousOrigin = runtime.getServerOrigin()
    const origin = await runtime.configureServer(serverInput.value)
    serverTestStatus.value = 'success'
    serverTestMessage.value = `连接成功: ${origin}`
    ms.success('服务器地址配置已更新并验证成功！')
    if (previousOrigin !== origin) {
      ms.info('正在切换服务器并重新加载账号作用域…')
      window.setTimeout(() => window.location.reload(), 450)
    }
    else {
      emit('refresh')
    }
  }
  catch (error) {
    serverTestStatus.value = 'error'
    serverTestMessage.value = error instanceof Error ? error.message : '连接服务器失败'
    ms.error(serverTestMessage.value)
  }
  finally {
    serverTesting.value = false
  }
}

// 退出登录
async function handleLogout() {
  try {
    await logout()
  }
  catch {}
  authStore.removeToken()
  try {
    await runtime.storage.flush?.()
  }
  catch (error) {
    console.warn('Failed to flush logout state immediately.', error)
  }
  ms.success('已安全退出登录')
  visible.value = false
  emit('refresh')
}
</script>

<template>
  <NModal
    v-model:show="visible"
    to=".pn-theme-root"
    preset="card"
    :bordered="false"
    :mask-closable="true"
    :closable="false"
    :auto-focus="false"
    class="user-hub-modal"
    style="width: min(1080px, calc(100vw - 32px)); height: min(720px, calc(100vh - 32px)); border-radius: 22px; overflow: hidden; padding: 0; box-shadow: 0 30px 100px rgba(2, 6, 23, 0.38);"
    content-style="padding: 0; height: 100%; display: flex;"
  >
    <div class="user-hub-container flex w-full h-full">
      <!-- 左侧边栏：品牌、账号身份、功能导航与登录状态。 -->
      <aside class="hub-sidebar flex flex-col justify-between w-[260px] p-4 select-none shrink-0 overflow-y-auto">
        <div class="sidebar-top flex flex-col">
          <div class="hub-brand" @click="currentTab = 'profile'">
            <span class="hub-brand-mark">PN</span>
            <span class="hub-brand-copy"><b>Panel Next</b><small>Extension 控制中心</small></span>
            <span class="hub-revision">R{{ syncRevision }}</span>
          </div>

          <!-- 用户个人身份卡片 (Profile Hero) -->
          <div
            class="profile-hero p-3.5 rounded-2xl relative overflow-hidden mb-4 cursor-pointer transition-all"
            @click="currentTab = 'profile'"
          >
            <div class="flex items-center space-x-3 relative z-10">
              <div class="avatar-glow relative">
                <NAvatar
                  :key="profileAvatarUrl"
                  round
                  :size="46"
                  :src="profileAvatarUrl || undefined"
                  fallback-src="/favicon.svg"
                  class="hub-profile-avatar"
                >
                  {{ profileName[0].toUpperCase() }}
                </NAvatar>
                <span
                  class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-900"
                  :class="authStore.token ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-400'"
                />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-bold text-white truncate">
                    {{ profileName }}
                  </h3>
                  <span class="profile-config-link">管理</span>
                </div>
                <p class="text-[11px] text-white/60 truncate mt-0.5">
                  {{ identitySubtitle }}
                </p>
              </div>
            </div>

            <!-- 连接状态小胶囊 -->
            <div class="mt-2.5 pt-2.5 border-t border-white/10 flex items-center justify-between text-[10px] text-white/60">
              <div class="flex items-center space-x-1.5">
                <span
                  class="w-1.5 h-1.5 rounded-full"
                  :class="connectionState.online ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'"
                />
                <span class="truncate max-w-[150px]" :title="runtime.getServerOrigin() || 'https://next.roayc.com'">
                  {{ (runtime.getServerOrigin() || 'https://next.roayc.com').replace(/^https?:\/\//, '') }}
                </span>
              </div>
              <span class="text-white/40">{{ connectionState.label }}</span>
            </div>
          </div>

          <!-- 系统核心功能导航菜单（无任何无用标签） -->
          <nav class="hub-nav-menu flex flex-col space-y-1">
            <div class="hub-nav-caption">
              功能设置
            </div>
            <button
              v-for="item in navItems"
              :key="item.key"
              type="button"
              class="nav-item-btn flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all group"
              :class="currentTab === item.key ? 'active-nav' : ''"
              @click="currentTab = item.key"
            >
              <div class="flex items-center space-x-3 min-w-0">
                <div
                  class="nav-icon-wrap w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  :style="{ backgroundColor: `${item.color}20`, color: item.color }"
                >
                  <SvgIcon :icon="item.icon" class="text-sm" />
                </div>
                <div class="flex flex-col min-w-0">
                  <span class="nav-item-label text-xs font-semibold truncate">{{ item.label }}</span>
                </div>
              </div>
            </button>
          </nav>
        </div>

        <!-- 底部快捷退出/登录按钮 -->
        <div class="sidebar-bottom pt-3 mt-3 border-t border-white/10">
          <NPopconfirm v-if="authStore.token" @positive-click="handleLogout">
            <template #trigger>
              <button
                type="button"
                class="w-full flex items-center justify-center space-x-2 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium transition-all"
              >
                <SvgIcon icon="tabler:logout" class="text-sm" />
                <span>退出当前账号</span>
              </button>
            </template>
            确定要退出当前账号吗？退出后扩展将返回访客模式。
          </NPopconfirm>
          <button
            v-else
            type="button"
            class="w-full flex items-center justify-center space-x-2 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium shadow-md transition-all"
            @click="visible = false; $router.push('/login')"
          >
            <SvgIcon icon="ph:user-bold" class="text-sm" />
            <span>登录以同步云端配置</span>
          </button>
        </div>
      </aside>

      <!-- 右侧主内容区域：现代化暗黑工作区 -->
      <main class="hub-main-content min-w-0 flex-1 flex flex-col overflow-hidden">
        <!-- 视口顶部状态条 -->
        <header class="content-header flex items-center justify-between px-6 py-4 backdrop-blur-md shrink-0">
          <div class="flex items-center space-x-2">
            <h2 class="text-base font-bold text-white">
              {{ selectedNavItem?.label }}
            </h2>
            <span class="content-description text-xs text-white/50">
              — {{ selectedNavItem?.desc }}
            </span>
          </div>

          <div class="flex items-center space-x-2">
            <button
              type="button"
              class="hub-header-action"
              title="刷新数据"
              @click="$emit('refresh')"
            >
              <SvgIcon icon="material-symbols:sync" class="text-xs" />
              <span>刷新</span>
            </button>
            <button type="button" class="hub-close-button" title="关闭个人中心" aria-label="关闭个人中心" @click="visible = false">
              <SvgIcon icon="line-md:close-small" />
            </button>
          </div>
        </header>

        <!-- 动态模块渲染容器 -->
        <div class="content-body flex-1 overflow-y-auto p-6">
          <!-- 0. 个人中心：账号资料、安全与设备会话只保留这一处。 -->
          <div v-if="currentTab === 'profile'" class="view-panel max-w-2xl mx-auto py-2 space-y-6">
            <section v-if="!authStore.token" class="settings-glass-card guest-profile-card">
              <div class="settings-section-heading">
                <span class="settings-section-icon"><SvgIcon icon="material-symbols:account-circle" /></span>
                <div><h3>登录后进入个人中心</h3><p>访客模式可以直接使用主页；登录后可管理资料、密码和多端设备会话。</p></div>
              </div>
              <button type="button" class="guest-login-action" @click="visible = false; $router.push('/login')">
                <SvgIcon icon="ph:user-bold" />
                <span>登录并同步个人资料</span>
              </button>
            </section>

            <div v-else class="account-center-shell">
              <Suspense>
                <template #default>
                  <div class="account-center-content">
                    <UserInfoApp embedded />
                    <section class="device-session-section">
                      <div class="settings-section-heading">
                        <span class="settings-section-icon"><SvgIcon icon="mdi:devices" /></span>
                        <div><h3>多端设备会话</h3><p>查看当前登录设备，刷新活动状态并撤销不再使用的会话。</p></div>
                      </div>
                      <UserSessionsApp embedded />
                    </section>
                  </div>
                </template>
                <template #fallback>
                  <div class="flex items-center justify-center py-10">
                    <NSpin />
                  </div>
                </template>
              </Suspense>
            </div>
          </div>

          <div v-else-if="currentTab === 'search'" class="view-panel max-w-2xl mx-auto py-2">
            <section class="settings-glass-card">
              <div class="settings-section-heading">
                <span class="settings-section-icon"><SvgIcon icon="material-symbols:search-rounded" /></span>
                <div><h3>桌面搜索栏</h3><p>此开关直接控制扩展首页的搜索框，并自动保存到扩展专属偏好。</p></div>
              </div>
              <label class="sidebar-setting-row">
                <span><SvgIcon icon="material-symbols:search-rounded" /><span><b>显示搜索栏</b><small>关闭后首页不再占用搜索区域</small></span></span>
                <NSwitch v-model:value="searchEnabledModel" />
              </label>
              <label class="sidebar-setting-row">
                <span><SvgIcon icon="mdi:web" /><span><b>默认搜索引擎</b><small>选择后立即保存，刷新页面不会重置</small></span></span>
                <NSelect v-model:value="searchEngineIdModel" :options="searchEngineOptions" size="small" class="setting-select-wide" />
              </label>
              <label class="sidebar-setting-row">
                <span><SvgIcon icon="mdi:open-in-new" /><span><b>搜索结果打开方式</b><small>当前页面或浏览器新标签页</small></span></span>
                <NSelect v-model:value="searchOpenModeModel" :options="searchOpenModeOptions" size="small" class="setting-select-wide" />
              </label>
              <label class="sidebar-setting-row">
                <span><SvgIcon icon="material-symbols:sync" /><span><b>搜索历史</b><small>最多仅在本机保存 10 条搜索词</small></span></span>
                <NSwitch v-model:value="searchHistoryEnabledModel" />
              </label>
              <button v-if="searchHistoryCount" type="button" class="settings-inline-action" @click="$emit('clearSearchHistory')">
                清除 {{ searchHistoryCount }} 条本地搜索历史
              </button>
              <p class="settings-effective-state">
                当前状态：{{ searchEnabledModel ? '首页正在显示搜索栏' : '首页搜索栏已隐藏' }}
              </p>
            </section>
          </div>

          <div v-else-if="currentTab === 'time'" class="view-panel max-w-2xl mx-auto py-2">
            <section class="settings-glass-card">
              <div class="settings-section-heading">
                <span class="settings-section-icon"><SvgIcon icon="material-symbols:routine-outline-rounded" /></span>
                <div><h3>时间与日期</h3><p>控制扩展首页顶部的大号时钟、秒数与日期区域。</p></div>
              </div>
              <label class="sidebar-setting-row">
                <span><SvgIcon icon="material-symbols:routine-outline-rounded" /><span><b>显示时间与日期</b><small>开关会立即作用于当前扩展页</small></span></span>
                <NSwitch v-model:value="clockEnabledModel" />
              </label>
              <label class="sidebar-setting-row">
                <span><SvgIcon icon="material-symbols:routine-outline-rounded" /><span><b>显示秒钟</b><small>关闭后只保留小时与分钟</small></span></span>
                <NSwitch v-model:value="clockSecondsModel" :disabled="!clockEnabledModel" />
              </label>
              <label class="sidebar-setting-row">
                <span><SvgIcon icon="material-symbols:routine-outline-rounded" /><span><b>显示日期与星期</b><small>控制时钟下方的日期信息</small></span></span>
                <NSwitch v-model:value="clockDateModel" :disabled="!clockEnabledModel" />
              </label>
              <label class="sidebar-setting-row">
                <span><SvgIcon icon="material-symbols:routine-outline-rounded" /><span><b>时间格式</b><small>12 小时制会显示上午或下午</small></span></span>
                <NSelect v-model:value="clockHourCycleModel" :options="hourCycleOptions" size="small" class="setting-select-wide" :disabled="!clockEnabledModel" />
              </label>
            </section>
          </div>

          <div v-else-if="currentTab === 'style'" class="view-panel max-w-2xl mx-auto py-2">
            <section class="settings-glass-card">
              <div class="settings-section-heading">
                <span class="settings-section-icon"><SvgIcon icon="ion:color-palette-outline" /></span>
                <div><h3>主题与壁纸</h3><p>主题控制颜色、图标包与组件 Token；壁纸设置控制背景、模糊和遮罩。</p></div>
              </div>
              <div class="settings-action-grid">
                <button type="button" @click="themeCenterVisible = true">
                  <SvgIcon icon="ion:color-palette-outline" /><span><b>打开主题中心</b><small>选择、预览并应用主题</small></span><SvgIcon icon="mdi:chevron-right" />
                </button>
                <button type="button" @click="openWallpaperSettings">
                  <SvgIcon icon="material-symbols:wallpaper" /><span><b>更换桌面壁纸</b><small>选择素材库中的壁纸并保存</small></span><SvgIcon icon="mdi:chevron-right" />
                </button>
              </div>
            </section>
            <ThemeSettingsModal
              :show="themeCenterVisible"
              surface="extension"
              :current-selection="panelConfig?.theme ?? null"
              @update:show="(value: boolean) => themeCenterVisible = value"
              @saved="onThemeSaved"
            />
          </div>

          <div v-else-if="currentTab === 'layout'" class="view-panel max-w-2xl mx-auto py-2">
            <section class="settings-glass-card">
              <div class="settings-section-heading">
                <span class="settings-section-icon"><SvgIcon icon="majesticons-applications" /></span>
                <div><h3>小组件与布局</h3><p>组件管理器会显示组件名称与功能，可添加、隐藏、配置；进入编辑后可拖动边框调整支持的尺寸。</p></div>
              </div>
              <div class="settings-action-grid">
                <button type="button" @click="openWidgetManager">
                  <SvgIcon icon="majesticons-applications" /><span><b>打开组件管理器</b><small>管理时钟、搜索和功能组件</small></span><SvgIcon icon="mdi:chevron-right" />
                </button>
              </div>
            </section>
          </div>

          <div v-else-if="currentTab === 'sidebar'" class="view-panel max-w-2xl mx-auto py-2">
            <section class="settings-glass-card">
              <div class="settings-section-heading">
                <span class="settings-section-icon"><SvgIcon icon="tabler:layout-sidebar-left-collapse-filled" /></span>
                <div><h3>侧边栏</h3><p>头像、分组、新增和底部设置始终使用同一条功能栏。</p></div>
              </div>
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="sidebar-setting-row"><span><SvgIcon icon="panel-next:swap-horizontal" /><span><b>侧边栏位置</b><small>固定在屏幕左侧或右侧</small></span></span><NSelect v-model:value="sidebarPositionModel" :options="sidebarPositionOptions" size="small" class="w-24" /></label>
                <label class="sidebar-setting-row"><span><SvgIcon icon="panel-next:visibility-off" /><span><b>自动隐藏</b><small>移开鼠标三秒后隐藏</small></span></span><NSwitch v-model:value="sidebarAutoHideModel" /></label>
                <label class="sidebar-setting-row"><span><SvgIcon icon="panel-next:swap-horizontal" /><span><b>滚轮切换分组</b><small>页面到达顶部或底部时切换</small></span></span><NSwitch v-model:value="sidebarWheelSwitchModel" /></label>
                <label class="sidebar-setting-row"><span><SvgIcon icon="majesticons-applications" /><span><b>侧边栏密度</b><small>调整图标尺寸与栏宽</small></span></span><NSelect v-model:value="sidebarDensityModel" :options="sidebarDensityOptions" size="small" class="w-24" /></label>
              </div>
            </section>
          </div>

          <!-- 2. 图库与素材中心 -->
          <div v-else-if="currentTab === 'gallery'" class="view-panel">
            <Suspense>
              <template #default>
                <UploadFileManagerApp />
              </template>
              <template #fallback>
                <div class="flex items-center justify-center py-20">
                  <NSpin size="large" />
                </div>
              </template>
            </Suspense>
          </div>

          <div v-else-if="currentTab === 'backup'" class="view-panel space-y-6">
            <section class="settings-glass-card">
              <div class="settings-section-heading">
                <span class="settings-section-icon"><SvgIcon icon="icon-park-outline:import-and-export" /></span>
                <div><h3>备份与恢复</h3><p>这里的操作会真实读写书签、分组与账号备份，不提供仅改变外观的占位按钮。</p></div>
              </div>
              <div v-if="syncStatus === 'offline' || syncStatus === 'error'" class="settings-effective-state">
                当前离线：云端操作会在连接恢复后继续。
              </div>
              <button type="button" class="sync-queue-action" @click="$emit('openSyncQueue')">
                <SvgIcon icon="material-symbols:sync" />管理待同步修改
              </button>
            </section>
            <Suspense>
              <template #default>
                <div class="space-y-6">
                  <ImportExportApp />
                  <NDivider style="border-color: rgba(255,255,255,0.1);" />
                  <BackupRestoreApp />
                </div>
              </template>
              <template #fallback>
                <div class="flex items-center justify-center py-20">
                  <NSpin size="large" />
                </div>
              </template>
            </Suspense>
          </div>

          <!-- 3. Docker 容器管理 -->
          <div v-else-if="currentTab === 'docker'" class="view-panel">
            <Suspense>
              <template #default>
                <DockerManagerApp />
              </template>
              <template #fallback>
                <div class="flex items-center justify-center py-20">
                  <NSpin size="large" />
                </div>
              </template>
            </Suspense>
          </div>

          <!-- 4. 系统与站点配置 -->
          <div v-else-if="currentTab === 'system'" class="view-panel space-y-6">
            <Suspense>
              <template #default>
                <div class="space-y-6">
                  <SiteSettingApp />
                </div>
              </template>
              <template #fallback>
                <div class="flex items-center justify-center py-20">
                  <NSpin size="large" />
                </div>
              </template>
            </Suspense>
          </div>

          <!-- 5. 扩展特有：服务器节点连接与测试 -->
          <div v-else-if="currentTab === 'server'" class="view-panel max-w-xl mx-auto py-6">
            <div class="p-6 rounded-2xl bg-white/[0.04] border border-white/10 shadow-lg space-y-5">
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xl">
                  <SvgIcon icon="mdi:web" />
                </div>
                <div>
                  <h3 class="text-sm font-bold text-white">
                    Panel Next 服务端配置
                  </h3>
                  <p class="text-xs text-white/60">
                    设置扩展拉取书签、同步配置与壁纸的目标服务端
                  </p>
                </div>
              </div>

              <div class="space-y-2">
                <label class="text-xs font-semibold text-white/80">服务器 Origin 地址</label>
                <NInput
                  v-model:value="serverInput"
                  placeholder="https://next.roayc.com"
                  size="large"
                  class="rounded-xl font-mono text-sm"
                />
                <span class="text-[11px] text-white/40">例如 https://next.roayc.com（不需要包含 /api 路径）</span>
              </div>

              <div v-if="serverTestMessage" class="p-3 rounded-xl text-xs flex items-center space-x-2" :class="serverTestStatus === 'success' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'">
                <SvgIcon icon="mdi:information-box-outline" class="text-base" />
                <span>{{ serverTestMessage }}</span>
              </div>

              <div class="pt-2 flex items-center space-x-3">
                <NButton
                  type="primary"
                  size="medium"
                  :loading="serverTesting"
                  class="flex-1 rounded-xl !bg-emerald-500 hover:!bg-emerald-600 font-semibold"
                  @click="handleSaveServer"
                >
                  测试并保存连接
                </NButton>
                <NButton
                  quaternary
                  size="medium"
                  class="rounded-xl text-white/70"
                  @click="serverInput = 'https://next.roayc.com'"
                >
                  重置为官方节点
                </NButton>
              </div>
            </div>
          </div>

          <!-- 6. 关于与版本信息 -->
          <div v-else-if="currentTab === 'about'" class="view-panel">
            <Suspense>
              <template #default>
                <AboutApp />
              </template>
              <template #fallback>
                <div class="flex items-center justify-center py-20">
                  <NSpin size="large" />
                </div>
              </template>
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  </NModal>
</template>

<style scoped>
:global(.user-hub-modal) {
  --hub-canvas: #020617;
  --hub-sidebar: rgba(15, 23, 42, .95);
  --hub-header: rgba(15, 23, 42, .72);
  --hub-surface: rgba(255, 255, 255, .045);
  --hub-surface-strong: rgba(15, 23, 42, .72);
  --hub-border: rgba(148, 163, 184, .16);
  --hub-text: #e2e8f0;
  --hub-text-strong: #f8fafc;
  --hub-text-muted: #94a3b8;
  --hub-shadow: rgba(0, 0, 0, .4);
}

:global(html:not(.dark) .user-hub-modal) {
  --hub-canvas: #eef2f7;
  --hub-sidebar: rgba(255, 255, 255, .88);
  --hub-header: rgba(255, 255, 255, .72);
  --hub-surface: rgba(255, 255, 255, .72);
  --hub-surface-strong: rgba(255, 255, 255, .9);
  --hub-border: rgba(100, 116, 139, .2);
  --hub-text: #334155;
  --hub-text-strong: #0f172a;
  --hub-text-muted: #64748b;
  --hub-shadow: rgba(15, 23, 42, .16);
}

:global(.user-hub-modal .n-card__content) {
  padding: 0 !important;
  height: 100%;
  background: var(--hub-canvas);
}

:global(.user-hub-modal) {
  color: var(--hub-text);
}

.user-hub-container,
.hub-main-content,
.content-body { color: var(--hub-text); background: var(--hub-canvas); }

.hub-sidebar {
  color: var(--hub-text);
  border-right: 1px solid var(--hub-border);
  background: var(--hub-sidebar);
  box-shadow: 4px 0 24px var(--hub-shadow);
}

.content-header { border-bottom: 1px solid var(--hub-border); background: var(--hub-header); }

:global(html:not(.dark)) .user-hub-container :deep(.text-white),
:global(html:not(.dark)) .user-hub-container :deep(.text-slate-100),
:global(html:not(.dark)) .user-hub-container :deep(.text-zinc-100) {
  color: var(--hub-text-strong) !important;
}

:global(html:not(.dark)) .user-hub-container :deep(.text-white\/75),
:global(html:not(.dark)) .user-hub-container :deep(.text-white\/70),
:global(html:not(.dark)) .user-hub-container :deep(.text-white\/60),
:global(html:not(.dark)) .user-hub-container :deep(.text-white\/50),
:global(html:not(.dark)) .user-hub-container :deep(.text-white\/40) {
  color: var(--hub-text-muted) !important;
}

.nav-item-btn {
  border-radius: 12px;
}

.nav-item-btn.active-nav {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.08) 100%);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.hub-header-action,
.hub-close-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.06);
  font-size: 12px;
  transition: background-color .2s ease, border-color .2s ease, color .2s ease;
}

.hub-header-action:hover,
.hub-close-button:hover {
  color: #fff;
  border-color: rgba(52, 211, 153, 0.36);
  background: rgba(16, 185, 129, 0.14);
}

.hub-close-button {
  width: 32px;
  padding: 0;
  font-size: 18px;
}

.view-panel {
  animation: fadeIn 0.25s ease-out;
}

.settings-glass-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
  border: 1px solid var(--hub-border);
  border-radius: 20px;
  background: var(--hub-surface);
  box-shadow: 0 18px 46px var(--hub-shadow);
  backdrop-filter: blur(22px);
}

.account-center-shell {
  padding: 18px;
  border: 1px solid var(--hub-border);
  border-radius: 22px;
  background: var(--hub-surface);
  box-shadow: 0 22px 60px var(--hub-shadow);
  backdrop-filter: blur(24px);
}

.account-center-content { display: flex; min-width: 0; flex-direction: column; gap: 18px; }
.device-session-section {
  min-width: 0;
  padding-top: 18px;
  border-top: 1px solid var(--hub-border);
}

.settings-section-heading { display: flex; align-items: flex-start; gap: 12px; }
.settings-section-heading h3 { margin: 0; color: var(--hub-text-strong); font-size: 15px; font-weight: 720; }
.settings-section-heading p { margin: 4px 0 0; color: var(--hub-text-muted); font-size: 11px; line-height: 1.6; }
.settings-section-icon { display: grid; width: 40px; height: 40px; flex: none; place-items: center; border-radius: 13px; color: #67e8f9; background: rgba(34,211,238,.12); font-size: 20px; }
.settings-effective-state { margin: 0; padding: 10px 12px; border-radius: 12px; color: #a5f3fc; background: rgba(8,145,178,.1); font-size: 11px; }
.guest-login-action {
  display: inline-flex;
  width: max-content;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border: 1px solid rgba(52,211,153,.42);
  border-radius: 12px;
  color: #ecfdf5;
  background: linear-gradient(135deg, rgba(16,185,129,.9), rgba(5,150,105,.9));
  box-shadow: 0 10px 26px rgba(5,150,105,.22);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.guest-login-action:hover { filter: brightness(1.08); }
.settings-action-grid { display: grid; gap: 10px; }
.settings-action-grid button {
  display: grid;
  grid-template-columns: 34px 1fr 20px;
  align-items: center;
  gap: 10px;
  padding: 14px;
  color: #cbd5e1;
  text-align: left;
  border: 1px solid rgba(148,163,184,.13);
  border-radius: 14px;
  background: rgba(15,23,42,.58);
  transition: background-color .18s ease, border-color .18s ease;
}
.settings-action-grid button:hover { border-color: rgba(103,232,249,.36); background: rgba(30,41,59,.78); }
.settings-action-grid button > svg:first-child { color: #67e8f9; font-size: 20px; }
.settings-action-grid button > span { display: flex; min-width: 0; flex-direction: column; }
.settings-action-grid b { color: #f8fafc; font-size: 12px; }
.settings-action-grid small { margin-top: 3px; color: #64748b; font-size: 10px; }
.sync-queue-action { display: inline-flex; width: max-content; align-items: center; gap: 6px; padding: 9px 12px; border: 1px solid rgba(45,212,191,.28); border-radius: 11px; color: #99f6e4; background: rgba(13,148,136,.12); font-size: 11px; }

.sidebar-setting-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 14px;
  border: 1px solid rgba(148, 163, 184, .12);
  border-radius: 14px;
  background: rgba(15, 23, 42, .58);
}

.sidebar-setting-row > span {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  color: #67e8f9;
}

.sidebar-setting-row > span > span { display: flex; min-width: 0; flex-direction: column; }
.sidebar-setting-row b { color: #f8fafc; font-size: 12px; }
.sidebar-setting-row small { margin-top: 2px; color: #64748b; font-size: 10px; }

/* 深度重载所有子组件的浅色卡片与白底，实现100%暗夜玻璃质感统一 */
:global(html.dark) .content-body :deep(.n-card),
:global(html.dark) .content-body :deep(.bg-slate-200),
:global(html.dark) .content-body :deep(.bg-slate-100),
:global(html.dark) .content-body :deep(.bg-zinc-100),
:global(html.dark) .content-body :deep(.dark\:bg-zinc-900),
:global(html.dark) .content-body :deep(.bg-white) {
  background-color: rgba(255, 255, 255, 0.04) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  color: #f1f5f9 !important;
}

:global(html.dark) .content-body :deep(.n-card-header__main),
:global(html.dark) .content-body :deep(.n-form-item-label__text),
:global(html.dark) .content-body :deep(h1),
:global(html.dark) .content-body :deep(h2),
:global(html.dark) .content-body :deep(h3),
:global(html.dark) .content-body :deep(h4) {
  color: #ffffff !important;
}

:global(html.dark) .content-body :deep(.text-slate-500),
:global(html.dark) .content-body :deep(.text-gray-500),
:global(html.dark) .content-body :deep(.text-zinc-500) {
  color: rgba(255, 255, 255, 0.6) !important;
}

:global(html.dark) .content-body :deep(.n-input),
:global(html.dark) .content-body :deep(.n-base-selection) {
  background-color: rgba(0, 0, 0, 0.3) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
}

.content-body :deep(.n-button) {
  border-radius: 10px;
  font-weight: 600;
}

:global(html.dark) .content-body :deep(.n-alert),
:global(html.dark) .content-body :deep(.n-data-table),
:global(html.dark) .content-body :deep(.n-upload-dragger) {
  border-color: rgba(148, 163, 184, 0.16) !important;
  background: rgba(15, 23, 42, 0.64) !important;
}

@media (max-width: 820px) {
  :global(.user-hub-modal) {
    width: calc(100vw - 16px) !important;
    height: calc(100vh - 16px) !important;
    border-radius: 16px !important;
  }

  .user-hub-container {
    flex-direction: column;
  }

  .hub-sidebar {
    width: 100%;
    max-height: 250px;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .feature-banner,
  .sidebar-bottom {
    display: none;
  }

  .hub-nav-menu {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
  }

  .content-body {
    padding: 16px;
  }
}

@media (max-width: 560px) {
  .content-description,
  .hub-header-action span {
    display: none;
  }

  .hub-header-action {
    width: 32px;
    padding: 0;
  }

  .content-header {
    padding: 12px 14px;
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Aurora Control Center：与扩展主页使用同一套分层、圆角和语义色。 */
:global(.user-hub-modal) {
  --hub-canvas: var(--pn-color-page-background, #0e1420);
  --hub-sidebar: var(--pn-sidebar-background, var(--pn-color-surface, #121a28));
  --hub-header: var(--pn-modal-background, var(--pn-color-surface, #101723));
  --hub-surface: var(--pn-color-surface, #161f2e);
  --hub-surface-strong: var(--pn-color-surface-hover, #1b2535);
  --hub-border: var(--pn-color-border, #303c50);
  --hub-text: var(--pn-color-text-secondary, #dce6f4);
  --hub-text-strong: var(--pn-color-text-primary, #f6f9fc);
  --hub-text-muted: var(--pn-color-text-muted, #8f9db1);
  --hub-accent: var(--pn-color-accent, #2eb8f0);
  --hub-accent-soft: var(--pn-sidebar-active-background, var(--pn-color-surface-hover, #15354d));
  --hub-danger: var(--pn-color-danger, #ef705c);
  --hub-shadow: rgba(0, 0, 0, .34);
}

:global(.user-hub-modal) { border: 1px solid var(--hub-border); background: var(--hub-canvas); }
.hub-sidebar { width: 260px !important; padding: 18px 14px !important; backdrop-filter: none !important; box-shadow: none; }
.hub-brand {
  min-height: 44px;
  padding: 2px 6px 14px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--hub-text-strong);
  cursor: pointer;
}
.hub-brand-mark {
  width: 34px;
  height: 34px;
  display: grid;
  flex: none;
  place-items: center;
  border-radius: 11px;
  color: white;
  background: linear-gradient(145deg, #2eb8f0, #5367db 56%, #8d58d1);
  box-shadow: 0 7px 18px rgba(25,76,123,.3);
  font-size: 10px;
  font-weight: 800;
}
.hub-brand-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.hub-brand-copy b { font-size: 13px; }
.hub-brand-copy small { margin-top: 2px; color: var(--hub-text-muted); font-size: 9px; }
.hub-revision { color: var(--hub-text-muted); font: 600 9px/1 ui-monospace, monospace; }

.profile-hero { border: 1px solid var(--hub-border) !important; background: var(--hub-surface-strong) !important; box-shadow: none !important; }
.profile-hero:hover { border-color: var(--hub-accent) !important; }
.hub-profile-avatar { border: 2px solid rgba(46, 184, 240, .5) !important; color: #fff !important; background: linear-gradient(145deg, #55cce4, #5467d9 55%, #9458d3) !important; }
.profile-config-link { color: var(--hub-accent); font-size: 10px; font-weight: 700; }
.hub-nav-caption { margin: 3px 10px 5px; color: var(--hub-text-muted); font-size: 9px; font-weight: 750; letter-spacing: .08em; }
.hub-nav-menu { gap: 3px; }
.nav-item-btn { min-height: 42px; padding: 7px 9px !important; color: var(--hub-text-muted); border: 0 !important; }
.nav-item-btn:hover { color: var(--hub-text-strong); background: var(--hub-surface-strong); }
.nav-item-btn.active-nav { color: var(--hub-accent); background: var(--hub-accent-soft); box-shadow: none; }
.nav-icon-wrap { width: 28px; height: 28px; border-radius: 9px; }
.nav-item-label { color: inherit; }
.content-header { min-height: 70px; padding: 0 24px !important; }
.content-header h2 { color: var(--hub-text-strong) !important; }
.content-description { color: var(--hub-text-muted) !important; }
.content-body { padding: 22px !important; }
.hub-header-action, .hub-close-button { color: var(--hub-text-muted); border-color: var(--hub-border); background: var(--hub-surface); }
.hub-header-action:hover, .hub-close-button:hover { color: var(--hub-accent); border-color: var(--hub-accent); background: var(--hub-accent-soft); }
.settings-glass-card, .account-center-shell { border-radius: 18px; background: var(--hub-surface); box-shadow: none; backdrop-filter: none; }
.settings-section-icon { color: var(--hub-accent); background: var(--hub-accent-soft); }
.settings-effective-state { color: var(--hub-accent); background: var(--hub-accent-soft); }
.settings-action-grid button, .sidebar-setting-row { color: var(--hub-text); border-color: var(--hub-border); background: var(--hub-surface-strong); }
.settings-action-grid button:hover { border-color: var(--hub-accent); background: var(--hub-accent-soft); }
.settings-action-grid button > svg:first-child, .sidebar-setting-row > span { color: var(--hub-accent); }
.settings-action-grid b, .sidebar-setting-row b { color: var(--hub-text-strong); }
.settings-action-grid small, .sidebar-setting-row small { color: var(--hub-text-muted); }
.setting-select-wide { width: 144px; }
.settings-inline-action { margin-top: 10px; padding: 7px 10px; border: 1px solid var(--hub-border); border-radius: 10px; color: var(--hub-accent); background: var(--hub-surface-strong); font-size: 10px; cursor: pointer; }
.settings-inline-action:hover { border-color: var(--hub-accent); background: var(--hub-accent-soft); }
.sync-queue-action { color: var(--hub-accent); border-color: rgba(46, 184, 240, .35); background: var(--hub-accent-soft); }
.guest-login-action { border-color: var(--hub-accent); color: white; background: var(--hub-accent); box-shadow: 0 8px 22px rgba(20, 127, 192, .25); }

:global(html:not(.dark)) .user-hub-container :deep(.text-white),
:global(html:not(.dark)) .user-hub-container :deep(.text-slate-100),
:global(html:not(.dark)) .user-hub-container :deep(.text-zinc-100) { color: var(--hub-text-strong) !important; }
:global(html:not(.dark)) .user-hub-container :deep(.bg-white\/\[0\.04\]),
:global(html:not(.dark)) .user-hub-container :deep(.bg-white\/\[0\.06\]),
:global(html:not(.dark)) .user-hub-container :deep(.bg-slate-900\/60) { background: var(--hub-surface) !important; }
:global(html:not(.dark)) .content-body :deep(.n-card),
:global(html:not(.dark)) .content-body :deep(.bg-white),
:global(html:not(.dark)) .content-body :deep(.bg-slate-100),
:global(html:not(.dark)) .content-body :deep(.bg-slate-200),
:global(html:not(.dark)) .content-body :deep(.bg-zinc-100) {
  color: var(--hub-text) !important;
  border-color: var(--hub-border) !important;
  background: var(--hub-surface) !important;
}
:global(html:not(.dark)) .content-body :deep(.n-input),
:global(html:not(.dark)) .content-body :deep(.n-base-selection) { border-color: var(--hub-border) !important; background: var(--hub-surface-strong) !important; }

@media (max-width: 820px) {
  .hub-sidebar { width: 100% !important; max-height: 210px; padding: 12px !important; }
  .hub-brand { padding-bottom: 8px; }
  .profile-hero { display: none; }
  .hub-nav-menu { display: flex; flex-direction: row; overflow-x: auto; scrollbar-width: none; }
  .nav-item-btn { flex: 0 0 auto; }
  .hub-nav-caption { display: none; }
  .content-header { min-height: 60px; padding: 0 15px !important; }
  .content-body { padding: 14px !important; }
}

@media (max-width: 560px) {
  .hub-sidebar { max-height: 170px; }
  .hub-brand-copy small, .hub-revision { display: none; }
  .nav-icon-wrap { display: none; }
  .nav-item-btn { min-height: 36px; padding: 7px 10px !important; }
}
</style>
