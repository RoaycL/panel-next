<script setup lang="ts">
import { ref, watch } from 'vue'
import type { UploadFileInfo } from 'naive-ui'
import { NButton, NCard, NColorPicker, NGrid, NGridItem, NInput, NInputGroup, NInputNumber, NModal, NPopconfirm, NSelect, NSlider, NSwitch, NUpload, NUploadDragger, useMessage } from 'naive-ui'
import { useAuthStore, usePanelState } from '@/store'
import { set as setUserConfig } from '@/api/panel/userConfig'
import { PanelPanelConfigStyleEnum } from '@/enums/panel'
import { t } from '@/locales'
import { getRuntime } from '@/runtime'
import { saveExtensionAppearance } from '@/runtime/extensionAppearance'
import GallerySelector from '@/components/common/GallerySelector/index.vue'

const showWallpaperGallery = ref(false)

const authStore = useAuthStore()
const panelState = usePanelState()

function handleWallpaperGallerySelect(url: string) {
  panelState.panelConfig.backgroundImageSrc = url
  showWallpaperGallery.value = false
}
const ms = useMessage()
const showWallpaperInput = ref(false)
const uploadAction = getRuntime().resolveUrl('/api/file/uploadImg')
const isExtension = getRuntime().kind === 'extension'

const isSaveing = ref(false)

function clonePanelConfig(config: Panel.panelConfig): Panel.panelConfig {
  return JSON.parse(JSON.stringify(config)) as Panel.panelConfig
}

let lastConfirmedExtensionAppearance = isExtension ? clonePanelConfig(panelState.panelConfig) : null

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
    const attempted = clonePanelConfig(panelState.panelConfig)
    const attemptedBytes = JSON.stringify(attempted)
    try {
      await saveExtensionAppearance(attempted)
      lastConfirmedExtensionAppearance = attempted
      ms.success('扩展外观已独立保存')
    }
    catch (err) {
      // A newer edit may already be visible and queued. Only roll the UI back
      // when it still represents the exact snapshot that failed.
      if (lastConfirmedExtensionAppearance && JSON.stringify(panelState.panelConfig) === attemptedBytes)
        panelState.applyPanelConfig(clonePanelConfig(lastConfirmedExtensionAppearance))
      ms.error('扩展外观保存失败，请重试')
      console.error('Failed to save extension appearance:', err)
    }
    return
  }
  setUserConfig({ panel: panelState.panelConfig }).then((res) => {
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
  <div class="bg-slate-200 dark:bg-zinc-900 rounded-[10px] p-[8px] overflow-auto">
    <NCard style="border-radius:10px" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        LOGO
      </div>

      <div>
        <div>
          {{ $t('apps.baseSettings.textContent') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NInput v-model:value="panelState.panelConfig.logoText" type="text" show-count :maxlength="20" placeholder="请输入文字" />
        </div>
      </div>
      <div class="flex items-center mt-[10px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.logoShow') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.logoShow" />
      </div>
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
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

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
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

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
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

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
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
    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
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
        <NUploadDragger style="width: 100%;">
          <div
            class="h-[200px] w-full border bg-slate-100 flex justify-center items-center cursor-pointer rounded-[10px]"
            :style="{ background: `url(${panelState.panelConfig.backgroundImageSrc}) no-repeat`, backgroundSize: 'cover' }"
          >
            <div class="text-shadow text-white">
              {{ $t('apps.baseSettings.uploadOrDragText') }}
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

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ $t('apps.baseSettings.contentArea') }}
      </div>

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

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ $t('apps.baseSettings.customFooter') }}
      </div>

      <NInput
        v-model:value="panelState.panelConfig.footerHtml"
        type="textarea"
        clearable
      />
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <NPopconfirm
        @positive-click="resetPanelConfig"
      >
        <template #trigger>
          <NButton size="small" quaternary type="error">
            {{ $t('common.reset') }}
          </NButton>
        </template>
        {{ $t('apps.baseSettings.resetWarnText') }}
      </NPopconfirm>

      <NButton size="small" quaternary type="success" class="ml-[10px]" @click="uploadCloud">
        {{ $t('common.save') }}
      </NButton>
    </NCard>

    <NModal v-model:show="showWallpaperGallery" preset="card" size="small" style="width: min(700px, calc(100vw - 24px)); max-height: calc(100vh - 24px);" :title="t('apps.baseSettings.selectFromGallery')">
      <GallerySelector type="wallpaper" @select="handleWallpaperGallerySelect" />
    </NModal>
  </div>
</template>

<style scoped>
.text-shadow{
  text-shadow: 0px 0px 5px gray;
}
</style>
