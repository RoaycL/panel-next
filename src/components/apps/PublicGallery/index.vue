<script setup lang="ts">
import { NAlert, NButton, NButtonGroup, NCard, NDropdown, NEllipsis, NGrid, NGridItem, NImage, NImageGroup, NSelect, NSpin, NUpload, useDialog, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { deletes, getList, updateType } from '@/api/system/publicFile'
import { SvgIcon } from '@/components/common'
import { copyToClipboard } from '@/utils/cmn'
import { t } from '@/locales'
import { useAuthStore } from '@/store'
import { getRuntime } from '@/runtime'

const imageList = ref<File.Info[]>([])
const ms = useMessage()
const dialog = useDialog()
const authStore = useAuthStore()
const loading = ref(false)
const activeType = ref<string>('all')
const uploadAction = getRuntime().resolveUrl('/api/publicFile/upload')
const uploadFileType = ref<string>('other')

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

const typeDropdownOptions = [
  { label: t('apps.uploadsFileManager.typeIcon'), key: 'icon' },
  { label: t('apps.uploadsFileManager.typeWallpaper'), key: 'wallpaper' },
  { label: t('apps.uploadsFileManager.typeOther'), key: 'other' },
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

onMounted(getFileList)
</script>

<template>
  <div class="bg-slate-200 dark:bg-zinc-900 p-2 h-full">
    <NSpin v-show="loading" size="small" />
    <NAlert type="info" :bordered="false">
      {{ $t('apps.publicGallery.alertText') }}
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
          :headers="{
            Authorization: `Bearer ${authStore.token}`,
            token: authStore.token as string,
          }"
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
                    <NButton size="tiny" tertiary :title="$t('apps.uploadsFileManager.copyLink')" @click="copyImageUrl(item.src)">
                      <template #icon>
                        <SvgIcon icon="ion-copy" />
                      </template>
                    </NButton>
                    <NDropdown
                      trigger="click"
                      :options="typeDropdownOptions"
                      @select="(key: string) => handleChangeType(item.id as number, key)"
                    >
                      <NButton size="tiny" tertiary :title="$t('apps.uploadsFileManager.changeType')">
                        <template #icon>
                          <SvgIcon icon="mdi-tag-outline" />
                        </template>
                      </NButton>
                    </NDropdown>
                    <NButton size="tiny" tertiary type="error" :title="$t('common.delete')" @click="handleDelete(item.id as number)">
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
