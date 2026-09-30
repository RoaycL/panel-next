<script setup lang="ts">
import { NButton, NColorPicker, NInput, NModal, NUpload } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import { ItemIcon } from '@/components/common'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import GallerySelector from '@/components/common/GallerySelector/index.vue'
import { useAuthStore } from '@/store'
import { apiRespErrMsg } from '@/utils/request/apiMessage'
import { getRuntime } from '@/runtime'
import { t } from '@/locales'

const props = defineProps<{
  itemIcon: Panel.ItemIcon | null
  fallbackText?: string
  siteUrl?: string
}>()
const emit = defineEmits<{
  (e: 'update:itemIcon', visible: Panel.ItemIcon): void // 定义修改父组件（prop内）的值的事件
}>()
const authStore = useAuthStore()
const runtime = getRuntime()
const uploadAction = runtime.resolveUrl('/api/file/uploadImg')
const modalTo = runtime.kind === 'extension' ? '.pn-theme-root' : undefined
const showGallery = ref(false)

// 默认图标背景色
const defautSwatchesBackground = [
  '#00000000',
  '#000000',
  '#ffffff',
  '#18A058',
  '#2080F0',
  '#F0A020',
  'rgba(208, 48, 80, 1)',
  '#C418D1FF',
]

const initData: Panel.ItemIcon = {
  itemType: 2,
  backgroundColor: '#2a2a2a6b',
}

const itemIconInfo = ref<Panel.ItemIcon>({ ...initData })
const isBundledBrand = computed(() => itemIconInfo.value.itemType === 3 && itemIconInfo.value.text?.startsWith('brand:'))
watch(() => props.itemIcon, (icon) => {
  itemIconInfo.value = {
    ...initData,
    ...icon,
    backgroundColor: icon?.backgroundColor || initData.backgroundColor,
  }
}, { immediate: true, deep: true })

function handleIconTypeRadioChange(type: number) {
  if (isBundledBrand.value && type !== 3)
    itemIconInfo.value.text = type === 1 ? Array.from(props.fallbackText || 'A').slice(0, 2).join('') : ''
  itemIconInfo.value.itemType = type
  handleChange()
}

function handleChange() {
  emit('update:itemIcon', { ...itemIconInfo.value })
}

function handleResetBackgroundColor() {
  itemIconInfo.value.backgroundColor = initData.backgroundColor
  handleChange()
}

const handleUploadFinish = ({
  file,
  event,
}: {
  file: UploadFileInfo
  event?: ProgressEvent
}) => {
  const res = JSON.parse((event?.target as XMLHttpRequest).response)
  if (res.code === 0) {
    const imageUrl = res.data.imageUrl
    itemIconInfo.value.src = imageUrl
    handleChange()
  }
  else {
    apiRespErrMsg(res)
    // ms.error(`${t('common.uploadFail')}:${res.msg}`)
  }

  return file
}

function handleGallerySelect(url: string) {
  itemIconInfo.value.src = url
  handleChange()
  showGallery.value = false
}
</script>

<template>
  <div class="icon-editor-container">
    <!-- 图标类型选择 (现代胶囊切换) -->
    <div class="type-selector-bar mb-3">
      <button
        type="button"
        class="type-pill-btn"
        :class="{ 'active': itemIconInfo.itemType === 1 }"
        @click="handleIconTypeRadioChange(1)"
      >
        <span class="type-text-mark" aria-hidden="true">A</span>
        <span>{{ $t('common.text') }}</span>
      </button>

      <button
        type="button"
        class="type-pill-btn"
        :class="{ 'active': itemIconInfo.itemType === 2 }"
        @click="handleIconTypeRadioChange(2)"
      >
        <SvgIcon icon="mdi-image-multiple-outline" class="text-sm" />
        <span>{{ $t('common.image') }}</span>
      </button>

      <button
        type="button"
        class="type-pill-btn"
        :class="{ 'active': itemIconInfo.itemType === 3 }"
        @click="handleIconTypeRadioChange(3)"
      >
        <SvgIcon icon="mdi-web" class="text-sm" />
        <span>{{ isBundledBrand ? $t('common.icon') : $t('iconItem.onlineIcon') }}</span>
      </button>
    </div>

    <!-- 核心编辑区 (预览与表单) -->
    <div class="icon-editor-body flex gap-4 items-start">
      <!-- 实时预览区 -->
      <div class="icon-preview-frame">
        <ItemIcon :item-icon="itemIconInfo" :fallback-text="fallbackText" :site-url="siteUrl" :cache-delay="450" />
      </div>

      <!-- 右侧表单配置 -->
      <div class="flex-1 min-w-0">
        <!-- 文字模式 -->
        <div v-if="itemIconInfo.itemType === 1">
          <div class="text-xs text-slate-400 dark:text-zinc-400 mb-1">
            {{ $t('iconGallery.iconText') }}
          </div>
          <NInput v-model:value="itemIconInfo.text" size="small" type="text" placeholder="如：GPT" @input="handleChange" />
        </div>

        <!-- 在线图标模式 (Iconify) -->
        <small v-if="isBundledBrand" class="icon-cache-hint">{{ $t('iconGallery.officialIcon') }}</small>
        <div v-if="itemIconInfo.itemType === 3 && !isBundledBrand" class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between text-xs text-slate-400 dark:text-zinc-400">
            <span>{{ $t('iconItem.onlineIcon') }} (Iconify 名称)</span>
            <a target="_blank" href="https://icon-sets.iconify.design/" class="text-sky-400 hover:underline flex items-center gap-0.5">
              <span>{{ $t('iconItem.onlineIconLibrary') }}</span>
              <SvgIcon icon="mdi-open-in-new" class="text-[11px]" />
            </a>
          </div>
          <NInput v-model:value="itemIconInfo.text" size="small" type="text" :placeholder="$t('iconItem.inputIconName')" @input="handleChange" />
        </div>

        <!-- 图片模式 (URL / 上传 / 图库) -->
        <div v-if="itemIconInfo.itemType === 2" class="flex flex-col gap-2">
          <div class="text-xs text-slate-400 dark:text-zinc-400">
            {{ $t('iconItem.inputIconUrlOrUpload') }}
          </div>
          <NInput v-model:value="itemIconInfo.src" size="small" type="text" placeholder="https://... 或本地上传" @input="handleChange" />
          <small class="icon-cache-hint">{{ $t('iconItem.localCacheHint') }}</small>
          <div class="icon-upload-actions flex gap-2">
            <NUpload
              :action="uploadAction"
              :show-file-list="false"
              name="imgfile"
              :data="{ fileType: 'icon' }"
              :headers="{
                Authorization: `Bearer ${authStore.token}`,
                token: authStore.token as string,
              }"
              @finish="handleUploadFinish"
            >
              <NButton size="small" secondary type="primary">
                <template #icon>
                  <SvgIcon icon="tabler-file-upload" />
                </template>
                {{ $t('iconItem.selectUpload') }}
              </NButton>
            </NUpload>
            <NButton size="small" secondary @click="showGallery = true">
              <template #icon>
                <SvgIcon icon="mdi-image-multiple-outline" />
              </template>
              {{ $t('iconItem.selectFromGallery') }}
            </NButton>
          </div>
        </div>

        <!-- 背景色调节 -->
        <div class="icon-color-controls flex items-center gap-2.5 mt-3 pt-2.5 border-t border-white/10 dark:border-white/10">
          <span class="text-xs text-slate-400 dark:text-zinc-400 whitespace-nowrap">{{ $t('common.backgroundColor') }}:</span>
          <div class="w-[120px]">
            <NColorPicker
              v-model:value="itemIconInfo.backgroundColor"
              size="small"
              :modes="['hex']"
              :swatches="defautSwatchesBackground"
              @complete="handleChange"
              @update-value="handleChange"
            />
          </div>
          <button
            v-if="itemIconInfo.backgroundColor !== initData.backgroundColor"
            type="button"
            class="text-xs text-sky-400 hover:text-sky-300 transition-colors underline cursor-pointer"
            @click="handleResetBackgroundColor"
          >
            {{ $t('common.reset') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 图库选择模态框 -->
    <NModal
      v-model:show="showGallery"
      preset="card"
      size="small"
      class="round-card-modal"
      :to="modalTo"
      style="width: min(720px, calc(100vw - 24px)); max-height: calc(100vh - 24px);"
      :title="t('iconItem.selectFromGallery')"
    >
      <GallerySelector type="icon" @select="handleGallerySelect" />
    </NModal>
  </div>
</template>

<style scoped>
.icon-editor-container {
  width: 100%;
}

.type-selector-bar {
  display: inline-flex;
  padding: 3px;
  border-radius: 10px;
  background: var(--pn-color-surface-hover, rgb(148 163 184 / 8%));
  border: 1px solid var(--pn-color-border, rgb(148 163 184 / 18%));
  gap: 3px;
}

.type-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 7px;
  border: none;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  color: var(--pn-color-text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.type-pill-btn:hover {
  color: var(--pn-color-accent, #0f9f75);
  background: color-mix(in srgb, var(--pn-color-accent, #0f9f75) 9%, transparent);
}

.type-pill-btn.active {
  background: var(--pn-color-accent, #0f9f75);
  color: #ffffff;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--pn-color-accent, #0f9f75) 25%, transparent);
}
.type-pill-btn:focus-visible { outline: 2px solid var(--pn-color-accent, #0f9f75); outline-offset: 2px; }
.type-text-mark { width: 14px; text-align: center; font-size: 13px; font-weight: 800; }

.icon-preview-frame {
  width: 68px;
  height: 68px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1.5px solid color-mix(in srgb, var(--pn-color-accent, #0f9f75) 35%, transparent);
  background: color-mix(in srgb, var(--pn-color-accent, #0f9f75) 6%, transparent);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.icon-cache-hint { color: var(--pn-color-text-muted, #64748b); font-size: 11px; line-height: 1.4; }
.icon-color-controls, .icon-upload-actions { flex-wrap: wrap; }
.icon-upload-actions :deep(.n-upload) { width: auto; flex: none; }
.icon-color-controls > div { flex: 0 0 120px; }
.icon-color-controls button { flex: none; white-space: nowrap; }

</style>
