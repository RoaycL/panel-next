<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { NBackTop, NButton, NButtonGroup, NDropdown, NModal, NSkeleton, NSpin, useDialog, useMessage } from 'naive-ui'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { AppIcon, AppStarter, EditItem } from './components'
import { Clock, SearchBox, SystemMonitor } from '@/components/deskModule'
import { SvgIcon } from '@/components/common'
import { deletes, getListByGroupId, saveSort } from '@/api/panel/itemIcon'
import { getList as getGroupList } from '@/api/panel/itemIconGroup'

import { setTitle, updateLocalUserInfo } from '@/utils/cmn'
import { useAuthStore, usePanelState, useUserStore } from '@/store'
import { PanelPanelConfigStyleEnum, PanelStateNetworkModeEnum } from '@/enums'
import { VisitMode } from '@/enums/auth'
import { router } from '@/router'
import { t } from '@/locales'
import { getRuntime } from '@/runtime'
import { readBootstrapSnapshot, refreshBootstrapSnapshot } from '@/sync/bootstrapCache'

interface ItemGroup extends Panel.ItemIconGroup {
  sortStatus?: boolean
  hoverStatus: boolean
  items?: Panel.ItemInfo[]
}

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

const items = ref<ItemGroup[]>([])
const filterItems = ref<ItemGroup[]>([])
type ExtensionSyncStatus = 'idle' | 'syncing' | 'online' | 'cached' | 'offline' | 'error'
const extensionSyncStatus = ref<ExtensionSyncStatus>(runtime.kind === 'extension' ? 'syncing' : 'idle')
const lastSyncAt = ref<string | null>(null)
let hasCachedSnapshot = false
let extensionRefreshPromise: Promise<void> | null = null

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

function openPage(openMethod: number, url: string, title?: string) {
  switch (openMethod) {
    case 1:
      runtime.openUrl(url, 'current')
      break
    case 2:
      runtime.openUrl(url, 'tab')
      break
    case 3:
      windowShow.value = true
      windowSrc.value = url
      windowTitle.value = title || url
      windowIframeIsLoad.value = true
      break

    default:
      break
  }
}

function handleItemClick(itemGroupIndex: number, item: Panel.ItemInfo) {
  if (items.value[itemGroupIndex] && items.value[itemGroupIndex].sortStatus) {
    handleEditItem(item)
    return
  }

  let jumpUrl = ''

  if (item)
    jumpUrl = (panelState.networkMode === PanelStateNetworkModeEnum.lan ? item.lanUrl : item.url) as string
  if (item.lanUrl === '')
    jumpUrl = item.url

  openPage(item.openMethod, jumpUrl, item.title)
}

function handWindowIframeIdLoad(_payload: Event) {
  windowIframeIsLoad.value = false
}

async function getList() {
  // 获取组数据
  const { code, data } = await getGroupList<Common.ListResponse<ItemGroup[]>>()
  if (code !== 0 || !data?.list)
    return false
  items.value = data.list
  await Promise.all(items.value.map(async (element, index) => {
    if (element.id)
      await updateItemIconGroupByNet(index, element.id)
  }))
  filterItems.value = items.value
  return true
}

// 从后端获取组下面的图标
async function updateItemIconGroupByNet(itemIconGroupIndex: number, itemIconGroupId: number) {
  const res = await getListByGroupId<Common.ListResponse<Panel.ItemInfo[]>>(itemIconGroupId)
  if (res.code === 0 && items.value[itemIconGroupIndex])
    items.value[itemIconGroupIndex].items = res.data.list
}

function handleRightMenuSelect(key: string | number) {
  dropdownShow.value = false
  // console.log(currentRightSelectItem, key)
  let jumpUrl = panelState.networkMode === PanelStateNetworkModeEnum.lan ? currentRightSelectItem.value?.lanUrl : currentRightSelectItem.value?.url
  if (currentRightSelectItem.value?.lanUrl === '')
    jumpUrl = currentRightSelectItem.value.url
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

function handleContextMenu(e: MouseEvent, itemGroupIndex: number, item: Panel.ItemInfo) {
  if (items.value[itemGroupIndex] && items.value[itemGroupIndex].sortStatus)
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

function handleSaveSort(itemGroup: ItemGroup) {
  const saveItems: Common.SortItemRequest[] = []
  if (itemGroup.items) {
    for (let i = 0; i < itemGroup.items.length; i++) {
      const element = itemGroup.items[i]
      saveItems.push({
        id: element.id as number,
        sort: i + 1,
      })
    }

    saveSort({ itemIconGroupId: itemGroup.id as number, sortItems: saveItems }).then(({ code, msg }) => {
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
    },

  ]

  if (currentRightSelectItem.value?.lanUrl && panelState.networkMode === PanelStateNetworkModeEnum.wan) {
    dropdownMenuOptions.push({
      label: t('panelHome.openLanUrl'),
      key: 'openLanUrl',
    })
  }

  if (currentRightSelectItem.value?.lanUrl && panelState.networkMode === PanelStateNetworkModeEnum.lan) {
    dropdownMenuOptions.push({
      label: t('panelHome.openWanUrl'),
      key: 'openWanUrl',
    })
  }

  if (canEdit.value) {
    dropdownMenuOptions.push({
      label: t('common.edit'),
      key: 'edit',
    }, {
      label: t('common.delete'),
      key: 'delete',
    })
  }

  return dropdownMenuOptions
}

function applyBootstrapData(data: Sync.BootstrapResponseV1) {
  panelState.applyPanelConfig(data.panel.config)
  authStore.setUserInfo(data.account)
  authStore.setVisitMode(VisitMode.VISIT_MODE_LOGIN)
  userStore.updateUserInfo(data.account)
  items.value = data.panel.groups.map(group => ({
    ...group,
    hoverStatus: false,
    items: group.items.map(item => ({ ...item })),
  }))
  filterItems.value = items.value
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
  void refreshExtensionBootstrap()
}

function handleBrowserOffline() {
  if (runtime.kind === 'extension')
    extensionSyncStatus.value = hasCachedSnapshot ? 'offline' : 'error'
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
  if (runtime.kind === 'extension') {
    window.addEventListener('online', handleBrowserOnline)
    window.addEventListener('offline', handleBrowserOffline)
    void refreshExtensionBootstrap()
    return
  }

  // 更新用户信息
  await updateLocalUserInfo()

  // 分组、卡片和面板配置来自同一个已验证会话，可以并行加载。
  await Promise.all([getList(), panelState.updatePanelConfigByCloud()])

  // 设置标题
  if (panelState.panelConfig.logoText)
    setTitle(panelState.panelConfig.logoText)
})

onUnmounted(() => {
  if (runtime.kind === 'extension') {
    window.removeEventListener('online', handleBrowserOnline)
    window.removeEventListener('offline', handleBrowserOffline)
  }
})

// 前端搜索过滤
function itemFrontEndSearch(keyword?: string) {
  keyword = keyword?.trim()
  if (keyword !== '' && panelState.panelConfig.searchBoxSearchIcon) {
    const filteredData = ref<ItemGroup[]>([])
    for (let i = 0; i < items.value.length; i++) {
      const element = items.value[i].items?.filter((item: Panel.ItemInfo) => {
        return (
          item.title.toLowerCase().includes(keyword?.toLowerCase() ?? '')
          || item.url.toLowerCase().includes(keyword?.toLowerCase() ?? '')
          || item.description?.toLowerCase().includes(keyword?.toLowerCase() ?? '')
        )
      })
      if (element && element.length > 0)
        filteredData.value.push({ items: element, hoverStatus: false })
    }
    filterItems.value = filteredData.value
  }
  else {
    filterItems.value = items.value
  }
}

function handleSetHoverStatus(groupIndex: number, hoverStatus: boolean) {
  if (items.value[groupIndex])
    items.value[groupIndex].hoverStatus = hoverStatus
}

function handleSetSortStatus(groupIndex: number, sortStatus: boolean) {
  if (items.value[groupIndex])
    items.value[groupIndex].sortStatus = sortStatus

  // 并未保存排序重新更新数据
  if (!sortStatus) {
    // 单独更新组
    if (items.value[groupIndex] && items.value[groupIndex].id)
      updateItemIconGroupByNet(groupIndex, items.value[groupIndex].id as number)
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
    <button
      v-if="layout === 'extension'"
      type="button"
      class="sync-indicator"
      :class="`sync-${extensionSyncStatus}`"
      :title="extensionSyncTitle"
      :disabled="extensionSyncStatus === 'syncing'"
      @click="refreshExtensionBootstrap"
    >
      <span class="sync-dot" />
      {{ extensionSyncLabel }}
    </button>
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
            <div class="logo">
              <span class="text-2xl md:text-6xl font-bold text-shadow">
                {{ panelState.panelConfig.logoText }}
              </span>
            </div>
            <div class="divider text-base lg:text-2xl mx-[10px]">
              |
            </div>
            <div class="text-shadow">
              <Clock :hide-second="!panelState.panelConfig.clockShowSecond" />
            </div>
          </div>
          <div v-if="panelState.panelConfig.searchBoxShow" class="home-search flex mt-[20px] mx-auto sm:w-full lg:w-[80%]">
            <SearchBox @item-search="itemFrontEndSearch" />
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
            @mouseenter="handleSetHoverStatus(itemGroupIndex, true)"
            @mouseleave="handleSetHoverStatus(itemGroupIndex, false)"
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
                <span class="mr-2 cursor-pointer " :title="t('common.sort')" @click="handleSetSortStatus(itemGroupIndex, !itemGroup.sortStatus)">
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
                  <div v-for="item, index in itemGroup.items" :key="index" :title="item.description" @contextmenu="(e) => handleContextMenu(e, itemGroupIndex, item)">
                    <AppIcon
                      :class="itemGroup.sortStatus ? 'cursor-move' : 'cursor-pointer'"
                      :item-info="item"
                      :icon-text-color="panelState.panelConfig.iconTextColor"
                      :icon-text-info-hide-description="panelState.panelConfig.iconTextInfoHideDescription || false"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :style="0"
                      @click="handleItemClick(itemGroupIndex, item)"
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
                  <div v-for="item, index in itemGroup.items" :key="index" :title="item.description" @contextmenu="(e) => handleContextMenu(e, itemGroupIndex, item)">
                    <AppIcon
                      :class="itemGroup.sortStatus ? 'cursor-move' : 'cursor-pointer'"
                      :item-info="item"
                      :icon-text-color="panelState.panelConfig.iconTextColor"
                      :icon-text-info-hide-description="!panelState.panelConfig.iconTextInfoHideDescription"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :style="1"
                      @click="handleItemClick(itemGroupIndex, item)"
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

        <NButton v-if="canEdit" color="#2a2a2a6b" @click="settingModalShow = !settingModalShow">
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

      <AppStarter v-model:visible="settingModalShow" />
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

    <EditItem v-model:visible="editItemInfoShow" :item-info="editItemInfoData" :item-group-id="currentAddItenIconGroupId" @done="handleEditSuccess" />

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
  user-select: none;
}

.sync-indicator {
  position: fixed;
  z-index: 40;
  top: 16px;
  right: 18px;
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
  padding: 0 8px;
}

.extension-home .logo span {
  font-size: clamp(24px, 3vw, 42px);
  letter-spacing: -.04em;
}

.extension-home .divider {
  display: none;
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

  .extension-home .home-content {
    padding: 26px 18px 80px;
  }

  .extension-home .home-identity {
    align-items: flex-start;
  }

  .extension-home .home-groups {
    grid-template-columns: 1fr;
  }

  .extension-home .item-list {
    padding: 18px 14px;
  }
}
</style>
