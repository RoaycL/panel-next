<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NModal } from 'naive-ui'
import { useAuthStore } from '@/store'
import { AppLoader, SvgIcon } from '@/components/common'
import { t } from '@/locales'

export interface AppItem {
  name: string
  componentName: string
  icon: string
  category: 'personal' | 'resources' | 'admin' | 'about'
  auth?: number
}

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', visible: boolean): void
}>()

const authStore = useAuthStore()
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
        name: t('adminSettingUsers.sessionsAppName'),
        componentName: 'UserSessions',
        icon: 'mdi:devices',
        category: 'admin',
        auth: 1,
      },
      {
        name: t('apps.dockerManager.appName'),
        componentName: 'DockerManager',
        icon: 'mdi:docker',
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
            <SvgIcon
              class="text-base transition-transform duration-300"
              :class="sidebarCollapsed ? 'rotate-180' : ''"
              icon="tabler:layout-sidebar-left-collapse"
            />
          </button>

          <!-- App Icon Pill -->
          <div class="app-brand-pill">
            <SvgIcon icon="majesticons-applications" class="text-lg text-sky-400" />
          </div>

          <!-- Main Title -->
          <div class="flex items-center gap-2.5">
            <span class="text-base font-semibold tracking-wide text-slate-800 dark:text-slate-100">
              {{ t('appLauncher.title') }}
            </span>
            <span class="text-slate-300 dark:text-zinc-600 font-light">/</span>
            <span class="active-badge">
              {{ activeApp?.name }}
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
          <AppLoader :component-name="componentName" class="h-full" />
        </div>
      </main>
    </div>
  </NModal>
</template>

<style>
/* Global Glassmorphism Modal Styles & Unscoped Layout */
.app-starter-glass-modal.n-card {
  width: 960px !important;
  max-width: min(960px, calc(100vw - 32px)) !important;
  height: 680px !important;
  max-height: min(680px, calc(100vh - 48px)) !important;
  margin: auto !important;
  border-radius: 20px !important;
  overflow: hidden !important;
  display: flex !important;
  flex-direction: column !important;
  background: rgba(18, 20, 26, 0.82) !important;
  backdrop-filter: blur(28px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(28px) saturate(190%) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08) inset !important;
}

html:not(.dark) .app-starter-glass-modal.n-card {
  background: rgba(255, 255, 255, 0.88) !important;
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.8) inset !important;
}

.app-starter-glass-modal .n-card-header {
  padding: 14px 20px 12px !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
  background: rgba(255, 255, 255, 0.03) !important;
  flex-shrink: 0 !important;
}

html:not(.dark) .app-starter-glass-modal .n-card-header {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06) !important;
  background: rgba(0, 0, 0, 0.02) !important;
}

.app-starter-glass-modal .n-card__content {
  padding: 0 !important;
  flex: 1 1 0% !important;
  min-height: 0 !important;
  height: 100% !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
}

.sidebar-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.2s ease;
}

.sidebar-toggle-btn:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.4);
  color: #60a5fa;
}

html:not(.dark) .sidebar-toggle-btn {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.08);
  color: rgba(0, 0, 0, 0.7);
}

html:not(.dark) .sidebar-toggle-btn:hover {
  background: rgba(37, 99, 235, 0.1);
  border-color: rgba(37, 99, 235, 0.3);
  color: #2563eb;
}

.app-brand-pill {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.18) 0%, rgba(99, 102, 241, 0.18) 100%);
  border: 1px solid rgba(56, 189, 248, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
}

.active-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.25);
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.1);
}

html:not(.dark) .active-badge {
  color: #0284c7;
  background: rgba(2, 132, 199, 0.1);
  border-color: rgba(2, 132, 199, 0.2);
}

/* Modal Body Layout */
.app-starter-body {
  display: flex;
  flex: 1 1 0%;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

/* Sidebar Styling */
.app-starter-sidebar {
  width: 230px;
  height: 100%;
  min-height: 0;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.02);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

html:not(.dark) .app-starter-sidebar {
  background: rgba(0, 0, 0, 0.015);
  border-right: 1px solid rgba(0, 0, 0, 0.06);
}

.app-starter-sidebar.collapsed {
  width: 68px;
}

.app-starter-sidebar.small-screen.collapsed {
  width: 0;
  border-right: none;
  overflow: hidden;
}

.sidebar-scroll-container {
  flex: 1 1 0%;
  min-height: 0;
  height: 100%;
  padding: 12px 10px 32px 10px;
  overflow-y: auto !important;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
}

html:not(.dark) .sidebar-scroll-container {
  scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
}

.category-group {
  margin-bottom: 14px;
}

.category-header {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  padding: 4px 8px 6px;
  user-select: none;
}

html:not(.dark) .category-header {
  color: rgba(0, 0, 0, 0.45);
}

.category-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  position: relative;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  text-align: left;
}

html:not(.dark) .nav-item-btn {
  color: rgba(0, 0, 0, 0.7);
}

.nav-item-btn:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #ffffff;
}

html:not(.dark) .nav-item-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #000000;
}

.nav-item-btn.active {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.18) 0%, rgba(99, 102, 241, 0.12) 100%);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #38bdf8;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(56, 189, 248, 0.12);
}

html:not(.dark) .nav-item-btn.active {
  background: linear-gradient(135deg, rgba(2, 132, 199, 0.12) 0%, rgba(79, 70, 229, 0.08) 100%);
  border-color: rgba(2, 132, 199, 0.3);
  color: #0284c7;
}

.nav-item-icon {
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-item-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-item-glow {
  position: absolute;
  right: 6px;
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: #38bdf8;
  box-shadow: 0 0 8px #38bdf8;
}

/* Main Content Area */
.app-starter-main {
  flex: 1 1 0%;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 14px 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.main-content-card {
  flex: 1 1 0%;
  min-height: 0;
  width: 100%;
  height: 100%;
  border-radius: 16px;
  padding: 16px 18px;
  overflow-y: auto !important;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
  /* Frosted Glass Texture */
  background: rgba(255, 255, 255, 0.035);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25) inset, 0 2px 8px 0 rgba(0, 0, 0, 0.1);
}

html:not(.dark) .main-content-card {
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.03) inset, 0 2px 8px 0 rgba(0, 0, 0, 0.02);
  scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
}

@media (max-width: 640px) {
  .app-starter-glass-modal.n-card {
    width: calc(100vw - 16px) !important;
    max-width: calc(100vw - 16px) !important;
    height: calc(100vh - 24px) !important;
    max-height: calc(100vh - 24px) !important;
    margin: 8px !important;
    border-radius: 16px !important;
  }

  .app-starter-sidebar-scrim {
    position: absolute;
    z-index: 2;
    inset: 0;
    border: 0;
    background: var(--pn-modal-overlay, rgba(2, 6, 23, .52));
    cursor: pointer;
  }

  .app-starter-sidebar.small-screen {
    position: absolute;
    z-index: 3;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(260px, calc(100% - 56px));
    border-right: 1px solid var(--pn-sidebar-border, rgba(148, 163, 184, .24));
    background: var(--pn-sidebar-background, #172033);
    box-shadow: var(--pn-effect-shadow-high, 0 16px 45px rgba(0, 0, 0, .32));
    transform: translateX(0);
    transition: transform var(--pn-effect-duration-normal, .2s), visibility var(--pn-effect-duration-normal, .2s);
  }

  .app-starter-sidebar.small-screen.collapsed {
    width: min(260px, calc(100% - 56px));
    visibility: hidden;
    transform: translateX(-105%);
    pointer-events: none;
  }

  .app-starter-main {
    width: 100%;
    padding: 10px;
  }

  .main-content-card { padding: 12px; }
}
</style>
