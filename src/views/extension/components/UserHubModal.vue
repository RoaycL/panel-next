<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import {
  NAvatar,
  NButton,
  NDivider,
  NInput,
  NModal,
  NPopconfirm,
  NSpin,
  useMessage,
} from 'naive-ui'
import { useAuthStore } from '@/store'
import { getRuntime } from '@/runtime'
import { SvgIcon } from '@/components/common'
import { logout } from '@/api'
import { updateInfo } from '@/api/system/user'
import { updateLocalUserInfo } from '@/utils/cmn'
import defaultBackground from '@/assets/defaultBackground.webp'

const props = defineProps<{
  show: boolean
  syncStatus: 'idle' | 'syncing' | 'online' | 'cached' | 'offline' | 'error'
  syncRevision: Sync.Revision
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'refresh'): void
}>()

const authStore = useAuthStore()
const ms = useMessage()
const runtime = getRuntime()

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

// 异步加载管理模块
const StyleApp = defineAsyncComponent(() => import('@/components/apps/Style/index.vue'))
const UploadFileManagerApp = defineAsyncComponent(() => import('@/components/apps/UploadFileManager/index.vue'))
const DockerManagerApp = defineAsyncComponent(() => import('@/components/apps/DockerManager/index.vue'))
const SiteSettingApp = defineAsyncComponent(() => import('@/components/apps/SiteSetting/index.vue'))
const UserInfoApp = defineAsyncComponent(() => import('@/components/apps/UserInfo/index.vue'))
const UserSessionsApp = defineAsyncComponent(() => import('@/components/apps/UserSessions/index.vue'))
const AboutApp = defineAsyncComponent(() => import('@/components/apps/About/index.vue'))
const BackupRestoreApp = defineAsyncComponent(() => import('@/components/apps/BackupRestore/index.vue'))
const ImportExportApp = defineAsyncComponent(() => import('@/components/apps/ImportExport/index.vue'))

type NavKey = 'profile' | 'style' | 'gallery' | 'docker' | 'system' | 'server' | 'about'
const currentTab = ref<NavKey>('profile')

// 个人资料配置表单
const editName = ref(authStore.userInfo?.name || authStore.userInfo?.username || '')
const editHeadImage = ref(authStore.userInfo?.headImage || '')
const isSavingProfile = ref(false)

watch(() => props.show, (val) => {
  if (val) {
    editName.value = authStore.userInfo?.name || authStore.userInfo?.username || ''
    editHeadImage.value = authStore.userInfo?.headImage || ''
  }
})

// 保存个人头像与用户名配置
async function handleSaveProfile() {
  if (!editName.value.trim()) {
    ms.warning('请输入用户名称/昵称')
    return
  }
  isSavingProfile.value = true
  try {
    const res = await updateInfo({
      name: editName.value.trim(),
      headImage: editHeadImage.value.trim(),
    })
    if (res.code === 0) {
      ms.success('个人资料与头像保存成功！')
      await updateLocalUserInfo()
      if (authStore.userInfo) {
        authStore.userInfo.name = editName.value.trim()
        authStore.userInfo.headImage = editHeadImage.value.trim()
      }
      emit('refresh')
    }
    else {
      ms.error(`保存失败: ${res.msg}`)
    }
  }
  catch (error) {
    ms.error(error instanceof Error ? error.message : '保存异常')
  }
  finally {
    isSavingProfile.value = false
  }
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
      label: '个人资料与头像',
      desc: '自定义头像、昵称与账号安全',
      icon: 'material-symbols:account-circle-outline',
      color: '#38bdf8',
    },
    {
      key: 'style' as NavKey,
      label: '界面风格定制',
      desc: '壁纸模糊、遮罩、时钟与卡片排版',
      icon: 'ion:color-palette-outline',
      color: '#a855f7',
    },
    {
      key: 'gallery' as NavKey,
      label: '图库素材中心',
      desc: '管理个人壁纸、应用图标与图床',
      icon: 'tabler:photo-up',
      color: '#ec4899',
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
      desc: '站点基础信息、数据备份与还原',
      icon: 'majesticons-applications',
      color: '#8b5cf6',
    },
    {
      key: 'server' as NavKey,
      label: '服务器节点连接',
      desc: '配置 Panel Next 服务端同步端点',
      icon: 'material-symbols:cloud-sync-outline-rounded',
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
    preset="card"
    :bordered="false"
    :mask-closable="true"
    :closable="false"
    :auto-focus="false"
    class="user-hub-modal"
    style="width: min(1080px, calc(100vw - 32px)); height: min(720px, calc(100vh - 32px)); border-radius: 22px; overflow: hidden; padding: 0; background: rgba(2, 6, 23, 0.98); border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: 0 30px 100px rgba(2, 6, 23, 0.66);"
    content-style="padding: 0; height: 100%; display: flex;"
  >
    <div class="user-hub-container flex w-full h-full bg-slate-950 text-slate-100">
      <!-- 左侧边栏：功能区Banner + 个人身份卡片 + 现代化功能导航 -->
      <aside class="hub-sidebar flex flex-col justify-between w-[320px] bg-slate-900/95 backdrop-blur-2xl border-r border-white/10 p-4 select-none shrink-0 overflow-y-auto">
        <div class="sidebar-top flex flex-col">
          <!-- 功能区艺术装饰插画 Banner (Feature Art Banner) -->
          <div class="feature-banner relative h-24 rounded-2xl overflow-hidden mb-4 shadow-lg border border-white/10 group cursor-pointer" @click="currentTab = 'profile'">
            <img
              :src="defaultBackground"
              alt="Feature Banner"
              class="w-full h-full object-cover brightness-75 group-hover:scale-105 transition-transform duration-500"
            >
            <div class="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/40 to-transparent flex flex-col justify-end p-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white tracking-wide flex items-center space-x-1.5">
                  <SvgIcon icon="material-symbols:hub-outline-rounded" class="text-emerald-400 text-sm" />
                  <span>PANEL NEXT 控制中心</span>
                </span>
                <span class="text-[10px] text-white/70 bg-white/10 px-2 py-0.5 rounded-full backdrop-blur-md">
                  Rev: {{ syncRevision }}
                </span>
              </div>
            </div>
          </div>

          <!-- 用户个人身份卡片 (Profile Hero) -->
          <div
            class="profile-hero p-3.5 rounded-2xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/15 shadow-md relative overflow-hidden mb-4 cursor-pointer hover:border-white/25 transition-all"
            @click="currentTab = 'profile'"
          >
            <div class="flex items-center space-x-3 relative z-10">
              <div class="avatar-glow relative">
                <NAvatar
                  round
                  :size="46"
                  :src="editHeadImage || authStore.userInfo?.headImage || undefined"
                  fallback-src="/favicon.svg"
                  class="border-2 border-emerald-400/40 shadow-md bg-slate-800"
                >
                  {{ (authStore.userInfo?.name || authStore.userInfo?.username || 'G')[0].toUpperCase() }}
                </NAvatar>
                <span
                  class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-900"
                  :class="authStore.token ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-400'"
                />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-bold text-white truncate">
                    {{ authStore.userInfo?.name || authStore.userInfo?.username || '访客模式' }}
                  </h3>
                  <span class="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors">
                    配置 ✏️
                  </span>
                </div>
                <p class="text-[11px] text-white/60 truncate mt-0.5">
                  {{ authStore.userInfo?.mail || (authStore.token ? `@${authStore.userInfo?.username}` : '点击右侧或登录同步个人配置') }}
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
            <div class="text-[10px] font-semibold text-white/40 uppercase tracking-wider px-3 mb-1">
              功能与系统控制
            </div>
            <button
              v-for="item in navItems"
              :key="item.key"
              type="button"
              class="nav-item-btn flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all group"
              :class="currentTab === item.key ? 'active-nav bg-white/15 text-white shadow-md border border-white/20' : 'text-white/75 hover:bg-white/10 hover:text-white border border-transparent'"
              @click="currentTab = item.key"
            >
              <div class="flex items-center space-x-3 min-w-0">
                <div
                  class="nav-icon-wrap w-7 h-7 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110 shrink-0"
                  :style="{ backgroundColor: `${item.color}20`, color: item.color }"
                >
                  <SvgIcon :icon="item.icon" class="text-sm" />
                </div>
                <div class="flex flex-col min-w-0">
                  <span class="text-xs font-semibold truncate">{{ item.label }}</span>
                  <span class="text-[10px] text-white/50 truncate">{{ item.desc }}</span>
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
                <SvgIcon icon="material-symbols:logout-rounded" class="text-sm" />
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
            <SvgIcon icon="material-symbols:login-rounded" class="text-sm" />
            <span>登录以同步云端配置</span>
          </button>
        </div>
      </aside>

      <!-- 右侧主内容区域：现代化暗黑工作区 -->
      <main class="hub-main-content min-w-0 flex-1 flex flex-col bg-slate-950 overflow-hidden">
        <!-- 视口顶部状态条 -->
        <header class="content-header flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/60 backdrop-blur-md shrink-0">
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
        <div class="content-body flex-1 overflow-y-auto p-6 bg-slate-950 text-slate-100">
          <!-- 0. 个人资料与头像可配置专属面板 (Profile & Avatar Config) -->
          <div v-if="currentTab === 'profile'" class="view-panel max-w-2xl mx-auto py-2 space-y-6">
            <div class="p-6 rounded-2xl bg-white/[0.04] border border-white/10 shadow-xl space-y-6">
              <div class="flex items-center space-x-4 pb-4 border-b border-white/10">
                <div class="relative group">
                  <NAvatar
                    round
                    :size="72"
                    :src="editHeadImage || authStore.userInfo?.headImage || undefined"
                    fallback-src="/favicon.svg"
                    class="border-2 border-emerald-400/50 shadow-xl bg-slate-800"
                  >
                    {{ (editName || 'G')[0]?.toUpperCase() }}
                  </NAvatar>
                </div>
                <div class="space-y-1 flex-1">
                  <h3 class="text-lg font-bold text-white">
                    个人身份与头像设定
                  </h3>
                  <p class="text-xs text-white/60">
                    可在此处直接修改用户昵称与自定义头像图片链接
                  </p>
                </div>
              </div>

              <!-- 用户名与头像表单 -->
              <div class="space-y-4">
                <div class="space-y-1.5">
                  <label class="text-xs font-semibold text-white/80">用户名 / 昵称 (3~15字符)</label>
                  <NInput
                    v-model:value="editName"
                    placeholder="请输入您的昵称"
                    size="large"
                    class="rounded-xl font-medium"
                  />
                </div>

                <div class="space-y-1.5">
                  <label class="text-xs font-semibold text-white/80">头像图片 URL (支持在线图片或本地上传路径)</label>
                  <NInput
                    v-model:value="editHeadImage"
                    placeholder="https://example.com/avatar.png 或 /uploads/file/..."
                    size="large"
                    class="rounded-xl font-mono text-sm"
                  />
                  <span class="text-[11px] text-white/40">支持主流图片链接、WebP 以及素材库图床链接</span>
                </div>

                <!-- 预设极简头像快捷选取 -->
                <div class="space-y-2 pt-2">
                  <span class="text-xs font-semibold text-white/70">快速挑选预设头像风格：</span>
                  <div class="flex items-center space-x-3 flex-wrap gap-y-2">
                    <button
                      v-for="(url, idx) in [
                        'https://api.dicebear.com/7.x/bottts/svg?seed=Felix',
                        'https://api.dicebear.com/7.x/bottts/svg?seed=Luna',
                        'https://api.dicebear.com/7.x/bottts/svg?seed=Leo',
                        'https://api.dicebear.com/7.x/bottts/svg?seed=Mia',
                        'https://api.dicebear.com/7.x/avataaars/svg?seed=Max',
                      ]"
                      :key="idx"
                      type="button"
                      class="p-1 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 hover:border-emerald-400/50 transition-all"
                      @click="editHeadImage = url"
                    >
                      <img :src="url" class="w-9 h-9 rounded-lg object-cover" alt="Preset Avatar">
                    </button>
                  </div>
                </div>

                <div class="pt-3">
                  <NButton
                    type="primary"
                    size="large"
                    block
                    :loading="isSavingProfile"
                    class="rounded-xl !bg-emerald-500 hover:!bg-emerald-600 font-bold"
                    @click="handleSaveProfile"
                  >
                    保存个人配置
                  </NButton>
                </div>
              </div>
            </div>

            <!-- 账号密码与设备会话 -->
            <div class="p-6 rounded-2xl bg-white/[0.04] border border-white/10 shadow-xl space-y-4">
              <h3 class="text-sm font-bold text-white flex items-center space-x-2">
                <SvgIcon icon="material-symbols:lock-reset" class="text-base text-amber-400" />
                <span>密码与多端设备会话</span>
              </h3>
              <Suspense>
                <template #default>
                  <div class="space-y-4">
                    <UserInfoApp />
                    <NDivider style="border-color: rgba(255,255,255,0.1);" />
                    <UserSessionsApp />
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

          <!-- 1. 界面与风格定制 -->
          <div v-else-if="currentTab === 'style'" class="view-panel">
            <Suspense>
              <template #default>
                <StyleApp />
              </template>
              <template #fallback>
                <div class="flex items-center justify-center py-20">
                  <NSpin size="large" />
                </div>
              </template>
            </Suspense>
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
                  <NDivider style="border-color: rgba(255,255,255,0.1);" />
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

          <!-- 5. 扩展特有：服务器节点连接与测试 -->
          <div v-else-if="currentTab === 'server'" class="view-panel max-w-xl mx-auto py-6">
            <div class="p-6 rounded-2xl bg-white/[0.04] border border-white/10 shadow-lg space-y-5">
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xl">
                  <SvgIcon icon="material-symbols:cloud-sync-outline-rounded" />
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
                <SvgIcon :icon="serverTestStatus === 'success' ? 'material-symbols:check-circle' : 'material-symbols:error'" class="text-base" />
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
:global(.user-hub-modal .n-card__content) {
  padding: 0 !important;
  height: 100%;
  background: #020617;
}

:global(.user-hub-modal) {
  color: #e2e8f0;
}

.hub-sidebar {
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
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

/* 深度重载所有子组件的浅色卡片与白底，实现100%暗夜玻璃质感统一 */
.content-body :deep(.n-card),
.content-body :deep(.bg-slate-200),
.content-body :deep(.bg-slate-100),
.content-body :deep(.bg-zinc-100),
.content-body :deep(.dark\:bg-zinc-900),
.content-body :deep(.bg-white) {
  background-color: rgba(255, 255, 255, 0.04) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  color: #f1f5f9 !important;
}

.content-body :deep(.n-card-header__main),
.content-body :deep(.n-form-item-label__text),
.content-body :deep(h1),
.content-body :deep(h2),
.content-body :deep(h3),
.content-body :deep(h4) {
  color: #ffffff !important;
}

.content-body :deep(.text-slate-500),
.content-body :deep(.text-gray-500),
.content-body :deep(.text-zinc-500) {
  color: rgba(255, 255, 255, 0.6) !important;
}

.content-body :deep(.n-input),
.content-body :deep(.n-base-selection) {
  background-color: rgba(0, 0, 0, 0.3) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
}

.content-body :deep(.n-button) {
  border-radius: 10px;
  font-weight: 600;
}

.content-body :deep(.n-alert),
.content-body :deep(.n-data-table),
.content-body :deep(.n-upload-dragger) {
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
</style>
