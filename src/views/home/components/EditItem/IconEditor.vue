<script setup lang="ts">
import { NButton, NColorPicker, NInput, NInputNumber, NModal, NSlider, NUpload } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import { ItemIcon } from '@/components/common'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import GallerySelector from '@/components/common/GallerySelector/index.vue'
import { useAuthStore } from '@/store'
import { apiRespErrMsg } from '@/utils/request/apiMessage'
import { getRuntime } from '@/runtime'
import { t } from '@/locales'
import { normalizeIconScale } from '@/icons/iconScale'

const props = defineProps<{
  itemIcon: Panel.ItemIcon | null
  fallbackText?: string
  siteUrl?: string
  showPreview?: boolean
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
const scalePercent = computed(() => Math.round(normalizeIconScale(itemIconInfo.value.scale) * 100))
function handleScaleChange(value: number | null) {
  if (value === null)
    return
  itemIconInfo.value.scale = normalizeIconScale(value / 100)
  handleChange()
}
function fillIconTile() {
  handleScaleChange(isBundledBrand.value ? 128 : itemIconInfo.value.itemType === 2 ? 100 : itemIconInfo.value.itemType === 1 ? 200 : 180)
}
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

function handleTransparentBackground() {
  itemIconInfo.value.backgroundColor = '#00000000'
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
      <div v-if="showPreview !== false" class="icon-preview-frame">
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

        <div class="icon-scale-controls">
          <div class="icon-scale-heading">
            <span>{{ $t('iconItem.contentScale') }}</span>
            <div class="icon-scale-actions">
              <NButton size="tiny" secondary @click="fillIconTile">
                {{ $t('iconItem.fillTile') }}
              </NButton>
              <NButton size="tiny" quaternary @click="handleScaleChange(100)">
                {{ $t('common.reset') }}
              </NButton>
            </div>
          </div>
          <div class="icon-scale-inputs">
            <NSlider :value="scalePercent" :min="50" :max="200" :step="1" :aria-label="$t('iconItem.contentScale')" @update:value="handleScaleChange" />
            <NInputNumber :value="scalePercent" :min="50" :max="200" :step="1" size="small" :aria-label="$t('iconItem.contentScale')" @update:value="handleScaleChange">
              <template #suffix>
                %
              </template>
            </NInputNumber>
          </div>
          <small class="icon-cache-hint">{{ $t('iconItem.contentScaleHint') }}</small>
        </div>

        <!-- 背景色调节 -->
        <div class="icon-color-controls flex items-center gap-2.5 mt-3 pt-2.5 border-t border-white/10 dark:border-white/10">
          <span class="text-xs text-slate-400 dark:text-zinc-400 whitespace-nowrap">{{ $t('common.backgroundColor') }}:</span>
          <div class="w-[120px]">
            <NColorPicker
              v-model:value="itemIconInfo.backgroundColor"
              class="icon-background-color-picker"
              size="small"
              :modes="['hex']"
              :swatches="defautSwatchesBackground"
              @complete="handleChange"
              @update-value="handleChange"
            />
          </div>
          <NButton size="small" :type="itemIconInfo.backgroundColor === '#00000000' ? 'primary' : 'default'" secondary @click="handleTransparentBackground">
            {{ $t('iconItem.noBackground') }}
          </NButton>
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
  color: var(--pn-color-surface, #ffffff);
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
.icon-background-color-picker { border-radius: 8px; overflow: hidden; }
.icon-color-controls :deep(.n-color-picker__fill) { inset: 0 !important; border-radius: inherit; overflow: hidden; }
.icon-background-color-picker :deep(.n-color-picker__value) { padding: 0 8px; font-size: 12px; font-weight: 600; }
.icon-color-controls button { flex: none; white-space: nowrap; }
.icon-editor-container :deep(.text-slate-400) { color: var(--pn-color-text-muted); }
.icon-editor-container .icon-color-controls { border-color: var(--pn-color-border); padding-top: 16px; margin-top: 16px; }
.type-selector-bar { display: flex; margin-bottom: 18px; padding: 4px; }
.type-pill-btn { flex: 1; justify-content: center; min-height: 34px; }
.icon-scale-controls { margin-top: 16px; display: grid; gap: 9px; }
.icon-scale-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--pn-color-text-secondary); }
.icon-scale-actions { display: flex; align-items: center; gap: 4px; }
.icon-scale-inputs { display: grid; grid-template-columns: minmax(60px, 1fr) 106px; gap: 16px; align-items: center; }

</style>
