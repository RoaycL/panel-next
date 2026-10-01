<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import { NModal } from 'naive-ui'
import { useAuthStore } from '@/store'
import { AppLoader, SvgIcon } from '@/components/common'
import ProfileAvatar from '@/components/common/ProfileAvatar/index.vue'
import { getRuntime } from '@/runtime'
import { t } from '@/locales'

const props = defineProps<{
  visible: boolean
}>()
const emit = defineEmits<{
  (e: 'update:visible', visible: boolean): void
}>()
const WallpaperPanel = defineAsyncComponent(() => import('@/views/extension/components/WallpaperSettingsPanel.vue'))
const MaterialPanel = defineAsyncComponent(() => import('@/components/apps/UploadFileManager/index.vue'))
const StylePanel = defineAsyncComponent(() => import('@/components/apps/Style/index.vue'))

export interface AppItem {
  name: string
  componentName: string
  icon: string
  category: 'personal' | 'resources' | 'admin' | 'about'
  auth?: number
}

const authStore = useAuthStore()
const profileName = computed(() => authStore.userInfo?.name || authStore.userInfo?.username || t('apps.userInfo.appName'))
const profileAvatar = computed(() => getRuntime().resolveUrl(authStore.userInfo?.headImage || ''))
const componentName = ref('UserInfo')
const sidebarCollapsed = ref(false)
const screenWidth = ref(0)
const isSmallScreen = ref(false)

const show = computed({
  get: () => props.visible,
  set: (visible: boolean) => {
    emit('update:visible', visible)
  },
})

const defaultApps: AppItem[] = [
  // 个人与偏好
  {
    name: t('apps.userInfo.appName'),
    componentName: 'UserInfo',
    icon: 'material-symbols-person-edit-outline-rounded',
    category: 'personal',
  },
  {
    name: t('apps.baseSettings.wallpaper'),
    componentName: 'Wallpaper',
    icon: 'mdi-image-multiple-outline',
    category: 'personal',
  },
  {
    name: t('apps.baseSettings.appName'),
    componentName: 'Style',
    icon: 'ion-color-palette-outline',
    category: 'personal',
  },
  {
    name: t('apps.itemGroupManage.appName'),
    componentName: 'ItemGroupManage',
    icon: 'material-symbols-ad-group-outline-rounded',
    category: 'personal',
  },
  // 资源与数据
  {
    name: t('apps.uploadsFileManager.appName'),
    componentName: 'UploadFileManager',
    icon: 'tabler:file-upload',
    category: 'resources',
  },
  {
    name: t('apps.exportImport.appName'),
    componentName: 'ImportExport',
    icon: 'icon-park-outline-import-and-export',
    category: 'resources',
  },
  // 关于
  {
    name: t('apps.about.appName'),
    componentName: 'About',
    icon: 'lucide-info',
    category: 'about',
  },
]

const apps = ref<AppItem[]>([...defaultApps])

const categories = computed(() => {
  const list: { key: AppItem['category']; title: string; items: AppItem[] }[] = [
    {
      key: 'personal',
      title: t('appLauncher.categoryPersonal'),
      items: apps.value.filter(a => a.category === 'personal'),
    },
    {
      key: 'resources',
      title: t('appLauncher.categoryResources'),
      items: apps.value.filter(a => a.category === 'resources'),
    },
  ]

  const adminItems = apps.value.filter(a => a.category === 'admin')
  if (adminItems.length > 0) {
    list.push({
      key: 'admin',
      title: t('appLauncher.categoryAdmin'),
      items: adminItems,
    })
  }

  const aboutItems = apps.value.filter(a => a.category === 'about')
  if (aboutItems.length > 0) {
    list.push({
      key: 'about',
      title: t('appLauncher.categoryAbout'),
      items: aboutItems,
    })
  }

  return list
})

const activeApp = computed(() => {
  return apps.value.find(a => a.componentName === componentName.value) || apps.value[0]
})

function handleClickApp(item: AppItem) {
  componentName.value = item.componentName
  if (isSmallScreen.value)
    sidebarCollapsed.value = true
}

function handleResize() {
  screenWidth.value = window.innerWidth
  if (screenWidth.value < 768) {
    sidebarCollapsed.value = true
    isSmallScreen.value = true
  }
  else {
    sidebarCollapsed.value = false
    isSmallScreen.value = false
  }
}

onMounted(() => {
  if (authStore.userInfo?.role === 1) {
    const adminApps: AppItem[] = [
      {
        name: t('apps.siteSettings.appName'),
        componentName: 'SiteSetting',
        icon: 'mdi:web',
        category: 'admin',
        auth: 1,
      },
      {
        name: t('adminSettingUsers.appName'),
        componentName: 'Users',
        icon: 'lucide-users',
        category: 'admin',
        auth: 1,
      },
      {
        name: t('apps.publicGallery.appName'),
        componentName: 'PublicGallery',
        icon: 'mdi:image-multiple-outline',
        category: 'resources',
        auth: 1,
      },
      {
        name: t('apps.backupRestore.appName'),
        componentName: 'BackupRestore',
        icon: 'clarity-hard-disk-solid',
        category: 'admin',
        auth: 1,
      },
    ]

    // Insert admin resources into categories
    const aboutIndex = apps.value.findIndex(a => a.category === 'about')
    if (aboutIndex !== -1) {
      apps.value.splice(aboutIndex, 0, ...adminApps)
    }
    else {
      apps.value.push(...adminApps)
    }
  }

  window.addEventListener('resize', handleResize)
  handleResize()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <NModal
    v-model:show="show"
    to=".pn-theme-root"
    preset="card"
    :bordered="false"
    :mask-closable="true"
    class="app-starter-glass-modal"
    style="width: 960px; max-width: min(960px, calc(100vw - 32px)); height: 680px; max-height: min(680px, calc(100vh - 48px)); display: flex; flex-direction: column; overflow: hidden;"
    header-style="padding: 14px 20px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); flex-shrink: 0;"
    content-style="padding: 0; flex: 1 1 0%; min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden;"
    role="dialog"
    aria-modal="true"
  >
    <!-- Modal Header -->
    <template #header>
      <div class="flex items-center justify-between w-full select-none pr-2">
        <div class="flex items-center gap-3">
          <!-- Sidebar Toggle -->
          <button
            type="button"
            class="sidebar-toggle-btn"
            :title="sidebarCollapsed ? t('appLauncher.expandMenu') : t('appLauncher.collapseMenu')"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>
          </button>

          <!-- App Icon Pill -->
          <div class="app-brand-pill">
            <SvgIcon :icon="activeApp?.icon || 'majesticons-applications'" class="text-lg" />
          </div>

          <!-- Main Title -->
          <div class="flex items-center gap-2.5">
            <span class="text-base font-semibold tracking-wide text-slate-800 dark:text-slate-100">
              {{ activeApp?.name }}
            </span>
            <span class="text-slate-300 dark:text-zinc-600 font-light">/</span>
            <span class="active-badge">
              {{ t('appLauncher.title') }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- Modal Content -->
    <div class="app-starter-body" style="flex: 1 1 0%; min-height: 0; height: 100%; display: flex; overflow: hidden; width: 100%;">
      <button
        v-if="isSmallScreen && !sidebarCollapsed"
        type="button"
        class="app-starter-sidebar-scrim"
        :aria-label="t('appLauncher.collapseMenu')"
        @click="sidebarCollapsed = true"
      />
      <!-- Left Sidebar -->
      <aside
        class="app-starter-sidebar"
        :class="{ 'collapsed': sidebarCollapsed, 'small-screen': isSmallScreen }"
        style="height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden;"
      >
        <button v-if="!sidebarCollapsed" type="button" class="web-profile-card" @click="handleClickApp(defaultApps[0])">
          <ProfileAvatar :src="profileAvatar" :size="42" />
          <span><strong>{{ profileName }}</strong><small>{{ authStore.userInfo?.username }}</small></span>
        </button>
        <div class="sidebar-scroll-container" style="flex: 1 1 0%; min-height: 0; height: 100%; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;">
          <template v-for="cat in categories" :key="cat.key">
            <div v-if="cat.items.length > 0" class="category-group">
              <div v-if="!sidebarCollapsed" class="category-header">
                {{ cat.title }}
              </div>
              <div class="category-items">
                <button
                  v-for="item in cat.items"
                  :key="item.componentName"
                  type="button"
                  class="nav-item-btn"
                  :class="{ 'active': componentName === item.componentName }"
                  :title="sidebarCollapsed ? item.name : undefined"
                  @click="handleClickApp(item)"
                >
                  <div class="nav-item-icon">
                    <SvgIcon :icon="item.icon" />
                  </div>
                  <span v-if="!sidebarCollapsed" class="nav-item-label">
                    {{ item.name }}
                  </span>
                  <div v-if="componentName === item.componentName" class="nav-item-glow" />
                </button>
              </div>
            </div>
          </template>
        </div>
      </aside>

      <!-- Right Main Content Area -->
      <main class="app-starter-main" style="flex: 1 1 0%; min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden;">
        <div class="main-content-card" style="flex: 1 1 0%; min-height: 0; height: 100%; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;">
          <WallpaperPanel v-if="componentName === 'Wallpaper'" @browse="componentName = 'PublicGallery'" />
          <MaterialPanel v-else-if="componentName === 'UploadFileManager'" mode="assets" />
          <StylePanel v-else-if="componentName === 'Style'" hide-wallpaper />
          <AppLoader v-else :component-name="componentName" class="h-full" />
        </div>
      </main>
    </div>
  </NModal>
</template>

<style>
.app-starter-glass-modal.n-card {
  width: 1120px !important; max-width: calc(100vw - 32px) !important;
  height: 760px !important; max-height: calc(100dvh - 48px) !important;
  margin: auto !important; border-radius: 24px !important; overflow: hidden !important;
  display: flex !important; flex-direction: column !important;
  color: var(--pn-color-text-primary);
}
.app-starter-glass-modal .n-card-header { padding: 22px 24px !important; flex-shrink: 0; border-bottom: 1px solid var(--pn-glass-border); }
.app-starter-glass-modal .n-card__content { padding: 0 !important; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.sidebar-toggle-btn, .app-brand-pill { display: inline-grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; color: var(--pn-color-text-primary); background: var(--pn-glass-control); border: 1px solid var(--pn-glass-border); }
.sidebar-toggle-btn { cursor: pointer; }
.sidebar-toggle-btn:hover { background: var(--pn-sidebar-active-background); }
.active-badge { font-size: 12px; color: var(--pn-color-text-secondary); }
.app-starter-body { position: relative; display: flex; flex: 1; min-height: 0; overflow: hidden; }
.app-starter-sidebar { width: 244px; flex-shrink: 0; background: var(--pn-glass-sheen), var(--pn-glass-detail); border-right: 1px solid var(--pn-glass-border); transition: width 160ms ease; }
.app-starter-sidebar.collapsed { width: 72px; }
.web-profile-card { display: flex; align-items: center; gap: 12px; margin: 18px 14px 8px; padding: 14px; border: 1px solid var(--pn-glass-border); border-radius: 16px; background: var(--pn-glass-panel); color: var(--pn-color-text-primary); cursor: pointer; text-align: left; }
.web-profile-card span { display: grid; gap: 4px; min-width: 0; }
.web-profile-card strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; }
.web-profile-card small { color: var(--pn-color-text-secondary); font-size: 12px; }
.sidebar-scroll-container { padding: 12px; scrollbar-width: thin; }
.category-group { margin-bottom: 18px; }
.category-header { padding: 8px 12px; font-size: 11px; font-weight: 600; color: var(--pn-color-text-muted); }
.category-items { display: grid; gap: 5px; }
.nav-item-btn { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 7px 10px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--pn-color-text-secondary); font-size: 13px; font-weight: 500; cursor: pointer; text-align: left; }
.nav-item-btn:hover, .nav-item-btn.active { background: var(--pn-sidebar-active-background); color: var(--pn-color-text-primary); }
.nav-item-btn.active { font-weight: 600; border-color: var(--pn-glass-border); }
.nav-item-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--pn-glass-panel); font-size: 18px; flex-shrink: 0; }
.nav-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-item-glow { display: none; }
.app-starter-main { padding: 24px; }
.main-content-card { padding: 0; scrollbar-width: thin; background: transparent; border: 0; box-shadow: none; }
@media (max-width: 767px) {
  .app-starter-glass-modal.n-card { width: calc(100vw - 16px) !important; max-width: calc(100vw - 16px) !important; height: calc(100dvh - 24px) !important; max-height: calc(100dvh - 24px) !important; border-radius: 18px !important; }
  .app-starter-glass-modal .n-card-header { padding: 14px !important; }
  .app-starter-main { padding: 14px; }
  .active-badge { display: none; }
  .app-starter-sidebar-scrim { position: absolute; z-index: 2; inset: 0; border: 0; background: var(--pn-glass-mask); }
  .app-starter-sidebar.small-screen { position: absolute; z-index: 3; inset: 0 auto 0 0; width: min(260px, calc(100% - 48px)); background: var(--pn-glass-floating); }
  .app-starter-sidebar.small-screen.collapsed { width: 0; overflow: hidden; border: 0; }
}
@media (prefers-reduced-motion: reduce) { .app-starter-sidebar { transition: none; } }
</style>
