<script setup lang="ts">
import { NAlert, NButton, NButtonGroup, NCard, NDropdown, NEllipsis, NGrid, NGridItem, NImage, NImageGroup, NSelect, NSpin, NUpload, useDialog, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { deletes, getList, updateType } from '@/api/system/file'
import { getImgbedConfig } from '@/api/imgbed'
import { set as savePanelConfig } from '@/api/panel/userConfig'
import { RoundCardModal, SvgIcon } from '@/components/common'
import { copyToClipboard, timeFormat } from '@/utils/cmn'
import { t } from '@/locales'
import { useAuthStore, usePanelState } from '@/store'
import { getRuntime } from '@/runtime'
import { saveExtensionAppearance } from '@/runtime/extensionAppearance'

interface InfoModalState {
  title: string
  show: boolean
  fileInfo: File.Info | null
}

const imageList = ref<File.Info[]>([])
const ms = useMessage()
const dialog = useDialog()
const panelStore = usePanelState()
const authStore = useAuthStore()
const loading = ref(false)
const activeType = ref<string>('all')
const imgbedConfigured = ref(false)
const uploadAction = getRuntime().resolveUrl('/api/file/uploadImg')
const uploadFileType = ref<string>('other')

const infoModalState = ref<InfoModalState>({
  show: false,
  title: '',
  fileInfo: null,
})

const typeOptions = computed(() => [
  { label: t('apps.uploadsFileManager.typeAll'), value: 'all' },
  { label: t('apps.uploadsFileManager.typeIcon'), value: 'icon' },
  { label: t('apps.uploadsFileManager.typeWallpaper'), value: 'wallpaper' },
  { label: t('apps.uploadsFileManager.typeOther'), value: 'other' },
])

const uploadTypeOptions = [
  { label: t('apps.uploadsFileManager.typeIcon'), value: 'icon' },
  { label: t('apps.uploadsFileManager.typeWallpaper'), value: 'wallpaper' },
  { label: t('apps.uploadsFileManager.typeOther'), value: 'other' },
]

async function getFileList() {
  loading.value = true
  const type = activeType.value === 'all' ? undefined : activeType.value
  const { data } = await getList<Common.ListResponse<File.Info[]>>(type)
  imageList.value = data.list
  loading.value = false
}

async function copyImageUrl(text: string) {
  const res = await copyToClipboard(text)
  if (res)
    ms.success(t('apps.uploadsFileManager.copySuccess'))
  else
    ms.error(t('apps.uploadsFileManager.copyFailed'))
}

function handleDelete(id: number) {
  dialog.warning({
    title: t('common.warning'),
    content: t('apps.uploadsFileManager.deleteWarningText'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      deletesImges(id)
    },
  })
}

async function deletesImges(id: number) {
  try {
    const { code, msg } = await deletes([id])
    if (code === 0) {
      getFileList()
      ms.success(t('common.success'))
    }
    else {
      ms.error(`${t('common.failed')}:${msg}`)
    }
  }
  catch {
    ms.error(t('common.failed'))
  }
}

function handleInfoClick(fileInfo: File.Info) {
  infoModalState.value.fileInfo = fileInfo
  infoModalState.value.show = true
}

async function handleSetWallpaper(imgSrc: string) {
  const previousBg = panelStore.panelConfig.backgroundImageSrc
  panelStore.panelConfig.backgroundImageSrc = imgSrc
  if (getRuntime().kind === 'extension') {
    try {
      await saveExtensionAppearance(panelStore.panelConfig)
      ms.success('扩展壁纸已独立保存')
    }
    catch (err) {
      if (panelStore.panelConfig.backgroundImageSrc === imgSrc)
        panelStore.panelConfig.backgroundImageSrc = previousBg
      ms.error('扩展壁纸保存失败，请重试')
      console.error('Failed to save extension wallpaper preference:', err)
    }
    return
  }
  savePanelConfig({ panel: panelStore.panelConfig })
}

function handleUploadFinish({ file }: { file: any }) {
  const res = JSON.parse((file.event?.target as XMLHttpRequest)?.response || '{}')
  if (res.code === 0 && res.data?.imageUrl) {
    getFileList()
    return
  }
  ms.error(t('common.failed'))
}

async function handleChangeType(id: number, type: string) {
  const { code, msg } = await updateType(id, type)
  if (code === 0) {
    ms.success(t('common.success'))
    getFileList()
  }
  else {
    ms.error(`${t('common.failed')}:${msg}`)
  }
}

const typeDropdownOptions = [
  { label: t('apps.uploadsFileManager.typeIcon'), key: 'icon' },
  { label: t('apps.uploadsFileManager.typeWallpaper'), key: 'wallpaper' },
  { label: t('apps.uploadsFileManager.typeOther'), key: 'other' },
]

onMounted(() => {
  getFileList()
  getImgbedConfig().then((res) => {
    if (res.code === 0)
      imgbedConfigured.value = res.data.configured
  })
})
</script>

<template>
  <div class="bg-slate-200 dark:bg-zinc-900 p-2 h-full">
    <NSpin v-show="loading" size="small" />
    <NAlert type="info" :bordered="false">
      {{ $t('apps.uploadsFileManager.alertText') }}
    </NAlert>

    <div class="flex items-center justify-between mt-2 mb-2 gap-2 flex-wrap">
      <NSelect
        v-model:value="activeType"
        :options="typeOptions"
        size="small"
        style="width: 160px"
        @update-value="getFileList"
      />
      <div class="flex items-center gap-2">
        <NSelect
          v-model:value="uploadFileType"
          :options="uploadTypeOptions"
          size="small"
          style="width: 120px"
        />
        <NUpload
          :action="uploadAction"
          :show-file-list="false"
          name="imgfile"
          accept=".webp,.png,.jpg,.jpeg,.gif,.svg,.avif,.ico"
          :data="{ fileType: uploadFileType }"
          :headers="authStore.token
            ? { Authorization: `Bearer ${authStore.token}`, token: authStore.token }
            : {}"
          @finish="handleUploadFinish"
        >
          <NButton size="small" type="primary">
            {{ $t('apps.uploadsFileManager.upload') }}
          </NButton>
        </NUpload>
      </div>
    </div>

    <div class="flex justify-center mt-2">
      <div v-if="imageList.length === 0 && !loading" class="flex">
        {{ $t('apps.uploadsFileManager.nothingText') }}
      </div>
      <NImageGroup v-else>
        <NGrid cols="2 300:2 600:4 900:6 1100:9" :x-gap="5" :y-gap="5">
          <NGridItem v-for=" item, index in imageList" :key="index">
            <NCard size="small" style="border-radius: 5px;" :bordered="true">
              <template #cover>
                <div class="card transparent-grid">
                  <NImage :lazy="true" style="object-fit: contain;height: 100%;" :src="item.src" />
                </div>
              </template>
              <template #footer>
                <span class="text-xs">
                  <NEllipsis>
                    {{ item.fileName }}
                  </NEllipsis>
                </span>
                <div class="flex justify-center mt-[10px]">
                  <NButtonGroup>
                    <NButton size="tiny" tertiary style="cursor: pointer;" :title="$t('apps.uploadsFileManager.copyLink')" @click="copyImageUrl(item.src)">
                      <template #icon>
                        <SvgIcon icon="ion-copy" />
                      </template>
                    </NButton>
                    <NDropdown
                      trigger="click"
                      :options="typeDropdownOptions"
                      @select="(key: string) => handleChangeType(item.id as number, key)"
                    >
                      <NButton size="tiny" tertiary style="cursor: pointer;" :title="$t('apps.uploadsFileManager.changeType')">
                        <template #icon>
                          <SvgIcon icon="mdi-tag-outline" />
                        </template>
                      </NButton>
                    </NDropdown>
                    <NButton size="tiny" tertiary style="cursor: pointer;" :title="timeFormat(item.createTime)" @click="handleInfoClick(item)">
                      <template #icon>
                        <SvgIcon icon="mdi-information-box-outline" />
                      </template>
                    </NButton>
                    <NButton size="tiny" tertiary style="cursor: pointer;" :title="$t('apps.uploadsFileManager.setWallpaper')" @click="handleSetWallpaper(item.src)">
                      <template #icon>
                        <SvgIcon icon="lucide:wallpaper" />
                      </template>
                    </NButton>
                    <NButton size="tiny" tertiary type="error" style="cursor: pointer;" :title="$t('common.delete')" @click="handleDelete(item.id as number)">
                      <template #icon>
                        <SvgIcon icon="material-symbols-delete" />
                      </template>
                    </NButton>
                  </NButtonGroup>
                </div>
              </template>
            </NCard>
          </NGridItem>
        </NGrid>
      </NImageGroup>
    </div>

    <RoundCardModal v-model:show="infoModalState.show" style="max-width: 300px;" size="small" :title="$t('apps.uploadsFileManager.infoTitle')">
      <div>
        <div class="mb-2">
          <span class="text-slate-500">
            {{ $t('apps.uploadsFileManager.fileName') }}
          </span>
          <div class="text-xs">
            {{ infoModalState.fileInfo?.fileName }}
          </div>
        </div>
        <div class="mb-2">
          <span class="text-slate-500">
            {{ $t('apps.uploadsFileManager.path') }}
          </span>
          <div class="text-xs">
            {{ infoModalState.fileInfo?.src }}
          </div>
        </div>
        <div class="mb-2">
          <span class="text-slate-500">
            {{ $t('apps.uploadsFileManager.uploadTime') }}
          </span>
          <div class="text-xs">
            {{ timeFormat(infoModalState.fileInfo?.createTime) }}
          </div>
        </div>
        <div class="mb-2">
          <span class="text-slate-500">
            {{ $t('apps.uploadsFileManager.typeLabel') }}
          </span>
          <div class="text-xs">
            {{ infoModalState.fileInfo?.type || 'other' }}
          </div>
        </div>
      </div>
    </RoundCardModal>
  </div>
</template>

<style scoped>
.card {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 80px;
}

.transparent-grid {
  background-image: linear-gradient(45deg, #f0f0f0 25%, transparent 25%, transparent 75%, #f0f0f0 75%),
    linear-gradient(45deg, #f0f0f0 25%, transparent 25%, transparent 75%, #f0f0f0 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}
</style>
