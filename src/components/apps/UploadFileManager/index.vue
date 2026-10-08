<script setup lang="ts">
import { NAlert, NButton, NButtonGroup, NCard, NDropdown, NEllipsis, NImage, NImageGroup, NInput, NSelect, NSpin, NUpload, useDialog, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { deleteInvalid, deletes, getList, updateType } from '@/api/system/file'
import type { DeleteInvalidResult } from '@/api/system/file'
import { set as savePanelConfig } from '@/api/panel/userConfig'
import { ItemIcon, RoundCardModal, SvgIcon } from '@/components/common'
import { copyToClipboard, timeFormat } from '@/utils/cmn'
import { t } from '@/locales'
import { useAuthStore, usePanelState } from '@/store'
import { getRuntime } from '@/runtime'
import { saveAndSyncExtensionWallpaper } from '@/runtime/extensionWallpaper'
import { enqueueAppearanceSave } from '@/themes/appearanceSaveQueue'

interface InfoModalState {
  title: string
  show: boolean
  fileInfo: File.Info | null
}

const props = withDefaults(defineProps<{ mode?: 'all' | 'assets' | 'wallpaper', wallpaperUrl?: string }>(), { mode: 'all' })
const emit = defineEmits<{ selectWallpaper: [url: string] }>()
const query = ref('')
const loadError = ref(false)

const imageList = ref<File.Info[]>([])
const ms = useMessage()
const dialog = useDialog()
const panelStore = usePanelState()
const authStore = useAuthStore()
const loading = ref(false)
const activeType = ref<string>('all')
const uploadAction = getRuntime().resolveUrl('/api/file/uploadImg')
const uploadFileType = ref<string>(props.mode === 'wallpaper' ? 'wallpaper' : 'icon')
const visibleImages = computed(() => imageList.value.filter(item =>
  (props.mode !== 'assets' || item.type !== 'wallpaper')
  && (props.mode !== 'wallpaper' || item.type === 'wallpaper')
  && (activeType.value === 'all' || (item.type || 'other') === activeType.value)
  && (!query.value.trim() || item.fileName.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))))

const infoModalState = ref<InfoModalState>({
  show: false,
  title: '',
  fileInfo: null,
})

const typeOptions = computed(() => [
  { label: t('apps.uploadsFileManager.typeAll'), value: 'all' },
  { label: t('apps.uploadsFileManager.typeIcon'), value: 'icon' },
  ...(props.mode === 'all' ? [{ label: t('apps.uploadsFileManager.typeWallpaper'), value: 'wallpaper' }] : []),
  { label: t('apps.uploadsFileManager.typeOther'), value: 'other' },
])

const uploadTypeOptions = computed(() => [
  { label: t('apps.uploadsFileManager.typeIcon'), value: 'icon' },
  ...(props.mode === 'all' ? [{ label: t('apps.uploadsFileManager.typeWallpaper'), value: 'wallpaper' }] : []),
  { label: t('apps.uploadsFileManager.typeOther'), value: 'other' },
])

async function getFileList() {
  loading.value = true
  loadError.value = false
  try {
    if (!authStore.token) {
      imageList.value = []
      return
    }
    const { code, data } = await getList<Common.ListResponse<File.Info[]>>(props.mode === 'wallpaper' ? 'wallpaper' : undefined)
    if (code !== 0 || !Array.isArray(data?.list))
      throw new Error('Invalid material list')
    imageList.value = data.list
  }
  catch {
    // 服务器不可达（例如 CORS/网络失败）时降级为空列表，避免未捕获的 Promise 拒绝。
    imageList.value = []
    loadError.value = true
  }
  finally {
    loading.value = false
  }
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
  if (props.wallpaperUrl !== undefined) {
    emit('selectWallpaper', imgSrc)
    return
  }
  const previousBg = panelStore.panelConfig.backgroundImageSrc
  panelStore.panelConfig.backgroundImageSrc = imgSrc
  if (getRuntime().kind === 'extension') {
    // 经统一外观保存队列串行化，避免整份外观写入与主题/布局保存交错覆盖。
    await enqueueAppearanceSave(async () => {
      try {
        const result = await saveAndSyncExtensionWallpaper(panelStore.panelConfig)
        if (result.status === 'local')
          ms.success(t('apps.uploadsFileManager.wallpaperSavedExtension'))
        else if (result.status === 'failed')
          ms.warning(result.message || '壁纸已保存在本机，但云端同步失败，请重试')
      }
      catch (err) {
        if (panelStore.panelConfig.backgroundImageSrc === imgSrc)
          panelStore.panelConfig.backgroundImageSrc = previousBg
        ms.error(t('apps.uploadsFileManager.wallpaperSaveFailedExtension'))
        console.error('Failed to save extension wallpaper preference:', err)
      }
    })
    return
  }
  await enqueueAppearanceSave(() => savePanelConfig({ panel: panelStore.panelConfig }))
}

function handleUploadFinish({ file }: { file: any }) {
  let res
  try { res = JSON.parse((file.event?.target as XMLHttpRequest)?.response || '{}') }
  catch { ms.error(t('common.failed')); return }
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

// 一键清理失效文件：删除磁盘上物理文件已不存在（失效）的文件记录
async function handleCleanInvalid() {
  dialog.warning({
    title: t('apps.uploadsFileManager.cleanInvalidTitle'),
    content: t('apps.uploadsFileManager.cleanInvalidConfirm'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        const { code, msg, data } = await deleteInvalid<DeleteInvalidResult>()
        if (code === 0) {
          if (data?.deletedCount > 0)
            ms.success(t('apps.uploadsFileManager.cleanInvalidSuccess', { count: data.deletedCount }))
          else
            ms.info(t('apps.uploadsFileManager.cleanInvalidEmpty'))
          getFileList()
        }
        else {
          ms.error(`${t('common.failed')}:${msg}`)
        }
      }
      catch {
        ms.error(t('common.failed'))
      }
    },
  })
}

// 文件类型 → 可读中文/翻译
function fileTypeLabel(type?: string | null) {
  if (type === 'icon')
    return t('apps.uploadsFileManager.typeIcon')
  if (type === 'wallpaper')
    return t('apps.uploadsFileManager.typeWallpaper')
  return t('apps.uploadsFileManager.typeOther')
}

const typeDropdownOptions = [
  { label: t('apps.uploadsFileManager.typeIcon'), key: 'icon' },
  { label: t('apps.uploadsFileManager.typeWallpaper'), key: 'wallpaper' },
  { label: t('apps.uploadsFileManager.typeOther'), key: 'other' },
]

onMounted(() => {
  getFileList()
})
</script>

<template>
  <div class="pn-app-page material-manager p-1 flex flex-col" :class="{ 'wallpaper-manager': mode === 'wallpaper' }">
    <NSpin v-show="loading" size="small" />
    <NAlert v-if="mode !== 'wallpaper'" type="info" :bordered="false">
      {{ mode === 'assets' ? '从本机上传的图标与图片集中展示在这里，壁纸请前往「主题与壁纸」设置。' : $t('apps.uploadsFileManager.alertText') }}
    </NAlert>

    <div class="pn-app-toolbar">
      <NSelect
        v-if="mode !== 'wallpaper'"
        v-model:value="activeType"
        :options="typeOptions"
        size="small"
        style="width: 160px"
      />
      <NInput v-model:value="query" clearable placeholder="搜索素材名称" class="material-search" size="small" />
      <NButton size="small" tertiary :loading="loading" @click="getFileList">
        刷新
      </NButton>
      <div class="pn-app-toolbar-controls upload-manager-actions">
        <NSelect
          v-if="mode !== 'wallpaper'"
          v-model:value="uploadFileType"
          :options="uploadTypeOptions"
          size="small"
          class="upload-type-select"
          aria-label="上传文件类型"
        />
        <NUpload
          class="upload-manager-trigger"
          :action="uploadAction"
          :disabled="!authStore.token"
          :show-file-list="false"
          name="imgfile"
          accept=".webp,.png,.jpg,.jpeg,.gif,.svg,.avif,.ico"
          :data="{ fileType: uploadFileType }"
          :headers="authStore.token
            ? { Authorization: `Bearer ${authStore.token}`, token: authStore.token }
            : {}"
          @finish="handleUploadFinish"
        >
          <NButton size="small" type="primary" :disabled="!authStore.token">
            {{ mode === 'wallpaper' ? '上传壁纸' : '上传素材' }}
          </NButton>
        </NUpload>
        <NButton v-if="mode !== 'wallpaper'" size="small" tertiary type="warning" class="upload-clean-action" :disabled="!authStore.token" @click="handleCleanInvalid">
          {{ $t('apps.uploadsFileManager.cleanInvalid') }}
        </NButton>
      </div>
    </div>

    <div class="material-result-count">
      {{ visibleImages.length }} 个{{ mode === 'wallpaper' ? '壁纸' : '素材' }}
    </div>
    <div class="material-results">
      <div v-if="loadError" class="pn-app-empty" role="alert">
        素材加载失败，请检查服务器连接后刷新重试。
      </div>
      <div v-else-if="visibleImages.length === 0 && !loading" class="pn-app-empty">
        {{ !authStore.token ? '登录后可查看和上传个人素材' : query ? '没有匹配的素材' : mode === 'wallpaper' ? '还没有上传壁纸，点击「上传壁纸」添加' : $t('apps.uploadsFileManager.nothingText') }}
      </div>
      <NImageGroup v-else>
        <div class="material-grid">
          <div v-for="item in visibleImages" :key="item.id || item.src">
            <NCard class="pn-app-card" size="small" :bordered="true">
              <template #cover>
                <div class="material-image-preview">
                  <ItemIcon v-if="item.type === 'icon'" :item-icon="{ itemType: 2, src: item.src }" :fallback-text="item.fileName" :size="64" />
                  <NImage v-else :lazy="true" object-fit="contain" :src="getRuntime().resolveUrl(item.src)" />
                </div>
              </template>
              <template #footer>
                <span class="text-xs">
                  <NEllipsis>
                    {{ item.fileName }}
                  </NEllipsis>
                </span>
                <small class="material-type">{{ fileTypeLabel(item.type) }}</small>
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
                    <NButton v-if="mode !== 'assets'" size="tiny" tertiary style="cursor: pointer;" :title="$t('apps.uploadsFileManager.setWallpaper')" @click="handleSetWallpaper(item.src)">
                      <template #icon>
                        <SvgIcon icon="lucide:wallpaper" />
                      </template>
                      <span v-if="mode === 'wallpaper'">{{ (props.wallpaperUrl ?? panelStore.panelConfig.backgroundImageSrc) === item.src ? '当前' : '应用' }}</span>
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
          </div>
        </div>
      </NImageGroup>
    </div>

    <RoundCardModal v-model:show="infoModalState.show" style="max-width: 300px;" size="small" :title="$t('apps.uploadsFileManager.infoTitle')">
      <div>
        <div class="mb-2">
          <span class="pn-app-muted">
            {{ $t('apps.uploadsFileManager.fileName') }}
          </span>
          <div class="text-xs">
            {{ infoModalState.fileInfo?.fileName }}
          </div>
        </div>
        <div class="mb-2">
          <span class="pn-app-muted">
            {{ $t('apps.uploadsFileManager.path') }}
          </span>
          <div class="text-xs">
            {{ infoModalState.fileInfo?.src }}
          </div>
        </div>
        <div class="mb-2">
          <span class="pn-app-muted">
            {{ $t('apps.uploadsFileManager.uploadTime') }}
          </span>
          <div class="text-xs">
            {{ timeFormat(infoModalState.fileInfo?.createTime) }}
          </div>
        </div>
        <div class="mb-2">
          <span class="pn-app-muted">
            {{ $t('apps.uploadsFileManager.typeLabel') }}
          </span>
          <div class="text-xs">
            {{ fileTypeLabel(infoModalState.fileInfo?.type) }}
          </div>
        </div>
      </div>
    </RoundCardModal>
  </div>
</template>

<style scoped>
.material-manager { gap: 16px; }
.material-manager .pn-app-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0; }
.material-search { flex: 1; min-width: 140px; }
.material-result-count { color: var(--pn-color-text-muted); font-size: 12px; }
.material-results { min-width: 0; }
.material-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 16px; }
.material-grid .pn-app-card { overflow: hidden; border-radius: 16px; background: var(--pn-glass-panel); border-color: var(--pn-glass-border); }
.material-image-preview { display: grid; place-items: center; height: 138px; padding: 16px; background: var(--pn-glass-control); }
.material-image-preview :deep(.n-image), .material-image-preview :deep(img) { max-width: 100%; max-height: 100%; }
.material-type { display: block; margin-top: 6px; color: var(--pn-color-text-muted); font-size: 11px; }
.wallpaper-manager .material-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.wallpaper-manager .material-image-preview { height: auto; aspect-ratio: 16 / 10; padding: 0; overflow: hidden; }
.wallpaper-manager .material-image-preview :deep(.n-image), .wallpaper-manager .material-image-preview :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.upload-manager-actions {
  flex-wrap: nowrap;
  min-width: 0;
}
.upload-manager-actions > :deep(.upload-type-select) {
  width: 120px !important;
  flex: 0 0 120px;
}
.upload-manager-actions > :deep(.upload-manager-trigger) {
  width: auto;
  flex: none;
}
.upload-manager-actions :deep(.n-upload-trigger) { display: inline-flex; }
.upload-manager-actions > :deep(.n-button) { flex: none; white-space: nowrap; }
.upload-manager-actions > :deep(.upload-clean-action) {
  color: var(--pn-color-text-primary, #0f172a);
  border: 1px solid color-mix(in srgb, var(--pn-color-warning, #f59e0b) 50%, transparent);
  background: color-mix(in srgb, var(--pn-color-warning, #f59e0b) 12%, var(--pn-glass-control, var(--pn-color-surface)));
}
@media (max-width: 560px) {
  .upload-manager-actions { justify-content: flex-start; gap: 6px; }
  .upload-manager-actions > :deep(.upload-type-select) { width: 80px !important; flex-basis: 80px; }
  .upload-manager-actions :deep(.n-button) { padding-inline: 10px; font-size: 12px; }
}
</style>
