<script setup lang="ts">
import { ref, watch } from 'vue'
import type { UploadFileInfo } from 'naive-ui'
import { NButton, NCard, NColorPicker, NGrid, NGridItem, NInput, NInputGroup, NInputNumber, NModal, NSelect, NSlider, NSwitch, NUpload, NUploadDragger, useDialog, useMessage } from 'naive-ui'
import { useAuthStore, usePanelState } from '@/store'
import { set as setUserConfig } from '@/api/panel/userConfig'
import { PanelPanelConfigStyleEnum } from '@/enums/panel'
import { t } from '@/locales'
import { getRuntime } from '@/runtime'
import { saveExtensionAppearance } from '@/runtime/extensionAppearance'
import NetworkModeSelect from '@/components/common/NetworkModeSelect.vue'
import { enqueueAppearanceSave } from '@/themes/appearanceSaveQueue'
import { saveAndSyncExtensionWallpaper } from '@/runtime/extensionWallpaper'
import { pickWallpaper } from '@/sync/wallpaper'
import GallerySelector from '@/components/common/GallerySelector/index.vue'

withDefaults(defineProps<{ hideWallpaper?: boolean }>(), { hideWallpaper: false })

const showWallpaperGallery = ref(false)

const authStore = useAuthStore()
const panelState = usePanelState()

function handleWallpaperGallerySelect(url: string) {
  panelState.panelConfig.backgroundImageSrc = url
  showWallpaperGallery.value = false
}
const ms = useMessage()
const dialog = useDialog()

function confirmReset() {
  dialog.warning({
    title: t('common.reset'),
    content: t('apps.baseSettings.resetWarnText'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    autoFocus: false,
    onPositiveClick: resetPanelConfig,
  })
}
const showWallpaperInput = ref(false)
const uploadAction = getRuntime().resolveUrl('/api/file/uploadImg')
const isExtension = getRuntime().kind === 'extension'

const isSaveing = ref(false)

function clonePanelConfig(config: Panel.panelConfig): Panel.panelConfig {
  return JSON.parse(JSON.stringify(config)) as Panel.panelConfig
}

let lastConfirmedExtensionAppearance = isExtension ? clonePanelConfig(panelState.panelConfig) : null
let wallpaperSyncFailed = false

const iconTypeOptions = [
  {
    label: t('apps.baseSettings.detailIcon'),
    value: PanelPanelConfigStyleEnum.info,
  },
  {
    label: t('apps.baseSettings.smallIcon'),
    value: PanelPanelConfigStyleEnum.icon,
  },
]

const maxWidthUnitOption = [
  {
    label: 'px',
    value: 'px',
  },
  {
    label: '%',
    value: '%',
  },
]

watch(panelState.panelConfig, () => {
  if (!isSaveing.value) {
    isSaveing.value = true

    setTimeout(() => {
      panelState.recordState()// 本地记录
      isSaveing.value = false
      uploadCloud()
    }, 1000)
  }
})

function handleUploadBackgroundFinish({
  file,
  event,
}: {
  file: UploadFileInfo
  event?: ProgressEvent
}) {
  const res = JSON.parse((event?.target as XMLHttpRequest).response)
  panelState.panelConfig.backgroundImageSrc = res.data.imageUrl
  return file
}

async function uploadCloud() {
  if (isExtension) {
    // 经统一外观保存队列串行化，避免整份外观写入跨调用点（主题/墙纸/widget）互相覆盖；
    // 快照在任务真正开始那刻读取，Payload 反映最新的整份配置而非调用瞬间的旧值。
    await enqueueAppearanceSave(async () => {
      const attempted = clonePanelConfig(panelState.panelConfig)
      const attemptedBytes = JSON.stringify(attempted)
      try {
        const wallpaperChanged = wallpaperSyncFailed || JSON.stringify(pickWallpaper(attempted)) !== JSON.stringify(pickWallpaper(lastConfirmedExtensionAppearance || {}))
        if (wallpaperChanged) {
          const result = await saveAndSyncExtensionWallpaper(attempted)
          wallpaperSyncFailed = result.status === 'failed'
          if (result.status === 'synced') ms.success('壁纸已保存并同步')
          else if (result.status === 'queued') ms.warning(result.message || '壁纸已保存，恢复连接后自动同步')
          else if (result.status === 'failed') ms.warning(result.message || '壁纸已保存在本机，但云端同步失败，请重试')
          else ms.success('壁纸已保存在本机，登录后可同步')
        }
        else {
          await saveExtensionAppearance(attempted)
          ms.success(t('apps.baseSettings.extensionAppearanceSaved'))
        }
        lastConfirmedExtensionAppearance = attempted
      }
      catch (err) {
        // A newer edit may already be visible and queued. Only roll the UI back
        // when it still represents the exact snapshot that failed.
        if (lastConfirmedExtensionAppearance && JSON.stringify(panelState.panelConfig) === attemptedBytes)
          panelState.applyPanelConfig(clonePanelConfig(lastConfirmedExtensionAppearance))
        ms.error(t('apps.baseSettings.extensionAppearanceSaveFailed'))
        console.error('Failed to save extension appearance:', err)
      }
    })
    return
  }
  await enqueueAppearanceSave(async () => {
    const res = await setUserConfig({ panel: panelState.panelConfig })
    if (res.code === 0)
      ms.success(t('apps.baseSettings.configSaved'))
    else
      ms.error(t('apps.baseSettings.configFailed', { message: res.msg }))
  })
}

function resetPanelConfig() {
  panelState.resetPanelConfig()
  uploadCloud()
}
</script>

<template>
  <div class="pn-app-page flex flex-col gap-3 overflow-auto">
    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        LOGO
      </div>

      <div>
        <div>
          {{ $t('apps.baseSettings.textContent') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NInput v-model:value="panelState.panelConfig.logoText" type="text" show-count :maxlength="20" :placeholder="t('apps.baseSettings.logoTextPlaceholder')" />
        </div>
      </div>
      <div class="flex items-center mt-[10px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.logoShow') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.logoShow" />
      </div>
    </NCard>

    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ $t('apps.baseSettings.clock') }}
      </div>
      <div class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.clockShow') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.clockShow" />
      </div>
      <div v-if="panelState.panelConfig.clockShow" class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.clockSecondShow') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.clockShowSecond" />
      </div>
    </NCard>

    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ $t('apps.baseSettings.searchBar') }}
      </div>
      <div class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('common.show') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.searchBoxShow" />
      </div>
      <div v-if="panelState.panelConfig.searchBoxShow" class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.searchBarSearchItem') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.searchBoxSearchIcon" />
      </div>
    </NCard>

    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ $t('apps.baseSettings.systemMonitorStatus') }}
      </div>
      <div class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('common.show') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.systemMonitorShow" />
      </div>
      <div v-if="panelState.panelConfig.systemMonitorShow" class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.showTitle') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.systemMonitorShowTitle" />
      </div>
      <div v-if="panelState.panelConfig.systemMonitorShow" class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.publicVisitModeShow') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.systemMonitorPublicVisitModeShow" />
      </div>
    </NCard>

    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ $t('common.icon') }}
      </div>
      <div class="mt-[5px]">
        <div>
          {{ $t('common.style') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NSelect v-model:value="panelState.panelConfig.iconStyle" :options="iconTypeOptions" />
        </div>
      </div>

      <div v-if="panelState.panelConfig.iconStyle === PanelPanelConfigStyleEnum.info" class="mt-[5px]">
        <div>
          {{ $t('apps.baseSettings.hideDescription') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NSwitch v-model:value="panelState.panelConfig.iconTextInfoHideDescription" />
        </div>
      </div>

      <div v-if="panelState.panelConfig.iconStyle === PanelPanelConfigStyleEnum.icon" class="mt-[5px]">
        <div>
          {{ $t('apps.baseSettings.hideTitle') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NSwitch v-model:value="panelState.panelConfig.iconTextIconHideTitle" />
        </div>
      </div>

      <div class="mt-[5px]">
        <div>
          {{ $t('common.textColor') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NColorPicker
            v-model:value="panelState.panelConfig.iconTextColor"
            :show-alpha="false"
            size="small"
            :modes="['hex']"
            :swatches="[
              '#000000',
              '#ffffff',
              '#18A058',
              '#2080F0',
              '#F0A020',
            ]"
          />
        </div>
      </div>
    </NCard>
    <NCard v-if="!hideWallpaper" class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ $t('apps.baseSettings.wallpaper') }}
      </div>
      <NUpload
        :action="uploadAction"
        :show-file-list="false"
        name="imgfile"
        accept=".webp,.png,.jpg,.jpeg,.gif,.svg,.avif"
        :headers="{
          Authorization: `Bearer ${authStore.token}`,
          token: authStore.token as string,
        }"
        :directory-dnd="true"
        @finish="handleUploadBackgroundFinish"
      >
        <NUploadDragger class="dropzone-dragger" style="width: 100%; background: transparent; border: none; padding: 0;">
          <div
            class="pn-app-dropzone dropzone-box group"
            :style="{
              backgroundImage: panelState.panelConfig.backgroundImageSrc ? `url(${panelState.panelConfig.backgroundImageSrc})` : undefined,
              backgroundSize: 'cover',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
            }"
          >
            <div v-if="panelState.panelConfig.backgroundImageSrc" class="dropzone-hover-overlay">
              <span class="text-sm font-medium">点击更换壁纸</span>
            </div>
            <div v-else class="dropzone-empty-prompt">
              <div class="text-xs font-semibold">
                {{ $t('apps.baseSettings.uploadOrDragText') }}
              </div>
              <div class="pn-app-muted text-[11px]">
                支持 .webp, .png, .jpg, .jpeg, .gif, .avif 格式
              </div>
            </div>
          </div>
        </NUploadDragger>
      </NUpload>

      <div class="flex items-center mt-[5px] gap-[10px]">
        <NButton size="small" @click="showWallpaperGallery = true">
          {{ $t('apps.baseSettings.selectFromGallery') }}
        </NButton>
        <span class="mr-[10px]">{{ $t('apps.baseSettings.customImageAddress') }}</span>
        <NSwitch v-model:value="showWallpaperInput" />
      </div>
      <div v-if="showWallpaperInput" class="mt-1">
        <NInput v-model:value="panelState.panelConfig.backgroundImageSrc" type="text" size="small" clearable />
      </div>

      <div class="flex items-center mt-[10px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.vague') }}</span>
        <NSlider v-model:value="panelState.panelConfig.backgroundBlur" class="max-w-[200px]" :step="2" :max="20" />
      </div>

      <div class="flex items-center mt-[10px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.mask') }}</span>
        <NSlider v-model:value="panelState.panelConfig.backgroundMaskNumber" class="max-w-[200px]" :step="0.1" :max="1" />
      </div>
    </NCard>

    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ $t('apps.baseSettings.contentArea') }}
      </div>

      <NetworkModeSelect />
      <NGrid cols="2">
        <NGridItem span="12 400:12">
          <div class="flex items-center mt-[5px]">
            <span class="mr-[10px]">{{ $t('apps.baseSettings.netModeChangeButtonShow') }}</span>
            <NSwitch v-model:value="panelState.panelConfig.netModeChangeButtonShow" />
          </div>
        </NGridItem>

        <NGridItem span="12 400:12">
          <div class="flex items-center mt-[10px]">
            <span class="mr-[10px]">{{ $t('apps.baseSettings.maxWidth') }}</span>
            <div class="flex">
              <NInputGroup>
                <NInputNumber v-model:value="panelState.panelConfig.maxWidth" size="small" :min="0" :show-button="false" :style="{ width: '100px' }" placeholder="1200" />
                <NSelect v-model:value="panelState.panelConfig.maxWidthUnit" :style="{ width: '80px' }" :options="maxWidthUnitOption" size="small" />
              </NInputGroup>
            </div>
          </div>
        </NGridItem>
        <NGridItem span="12 400:12">
          <div class="flex items-center mt-[10px]">
            <span class="mr-[10px]">{{ $t('apps.baseSettings.leftRightMargin') }}</span>
            <NSlider v-model:value="panelState.panelConfig.marginX" class="max-w-[200px]" :step="1" :max="100" />
          </div>
        </NGridItem>
        <NGridItem span="12 400:12">
          <div class="flex items-center mt-[10px]">
            <span class="mr-[10px]">{{ $t('apps.baseSettings.topMargin') }} (%)</span>
            <NSlider v-model:value="panelState.panelConfig.marginTop" class="max-w-[200px]" :step="1" :max="50" />
          </div>
        </NGridItem>
        <NGridItem span="12 400:6">
          <div class="flex items-center mt-[10px]">
            <span class="mr-[10px]">{{ $t('apps.baseSettings.bottomMargin') }} (%)</span>
            <NSlider v-model:value="panelState.panelConfig.marginBottom" class="max-w-[200px]" :step="1" :max="50" />
          </div>
        </NGridItem>
      </NGrid>
    </NCard>

    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ $t('apps.baseSettings.customFooter') }}
      </div>

      <NInput
        v-model:value="panelState.panelConfig.footerHtml"
        type="textarea"
        clearable
      />
    </NCard>

    <NCard class="pn-app-card" size="small">
      <div class="pn-app-actions">
        <NButton size="small" quaternary type="error" @click="confirmReset">
          {{ $t('common.reset') }}
        </NButton>
        <NButton size="small" type="primary" @click="uploadCloud">
          {{ $t('common.save') }}
        </NButton>
      </div>
    </NCard>

    <NModal v-model:show="showWallpaperGallery" to=".pn-theme-root" preset="card" size="small" class="round-card-modal" style="width: min(700px, calc(100vw - 24px)); max-height: calc(100vh - 24px);" :title="t('apps.baseSettings.selectFromGallery')">
      <GallerySelector type="wallpaper" @select="handleWallpaperGallerySelect" />
    </NModal>
  </div>
</template>

<style scoped>
.dropzone-box {
  height: 160px;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

.dropzone-empty-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px;
  text-align: center;
}

.dropzone-hover-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
}

.dropzone-box:hover .dropzone-hover-overlay,
.dropzone-box:focus-within .dropzone-hover-overlay {
  opacity: 1;
}
</style>
