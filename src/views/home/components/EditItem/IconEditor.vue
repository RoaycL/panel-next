<script setup lang="ts">
import { NButton, NColorPicker, NInput, NModal, NUpload } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { computed, ref } from 'vue'
import { ItemIcon } from '@/components/common'
import GallerySelector from '@/components/common/GallerySelector/index.vue'
import { useAuthStore } from '@/store'
import { apiRespErrMsg } from '@/utils/request/apiMessage'
import { getRuntime } from '@/runtime'
import { t } from '@/locales'

const props = defineProps<{
  itemIcon: Panel.ItemIcon | null
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

const itemIconInfo = computed({
  get() {
    const v = {
      ...initData,
      ...props.itemIcon,
      backgroundColor: props.itemIcon?.backgroundColor || initData.backgroundColor,
    }
    return v
  },
  set() {
    handleChange()
  },
})

function handleIconTypeRadioChange(type: number) {
  // checkedValueRef.value = type
  itemIconInfo.value.itemType = type
  handleChange()
}

function handleChange() {
  emit('update:itemIcon', itemIconInfo.value || null)
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
    emit('update:itemIcon', itemIconInfo.value || null)
  }
  else {
    apiRespErrMsg(res)
    // ms.error(`${t('common.uploadFail')}:${res.msg}`)
  }

  return file
}

function handleGallerySelect(url: string) {
  itemIconInfo.value.src = url
  emit('update:itemIcon', itemIconInfo.value || null)
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
        <SvgIcon icon="tabler:letter-case" class="text-sm" />
        <span>{{ $t('common.text') }}</span>
      </button>

      <button
        type="button"
        class="type-pill-btn"
        :class="{ 'active': itemIconInfo.itemType === 2 }"
        @click="handleIconTypeRadioChange(2)"
      >
        <SvgIcon icon="tabler:photo" class="text-sm" />
        <span>{{ $t('common.image') }}</span>
      </button>

      <button
        type="button"
        class="type-pill-btn"
        :class="{ 'active': itemIconInfo.itemType === 3 }"
        @click="handleIconTypeRadioChange(3)"
      >
        <SvgIcon icon="tabler:world" class="text-sm" />
        <span>{{ $t('iconItem.onlineIcon') }}</span>
      </button>
    </div>

    <!-- 核心编辑区 (预览与表单) -->
    <div class="icon-editor-body flex gap-4 items-start">
      <!-- 实时预览区 -->
      <div class="icon-preview-frame">
        <ItemIcon :item-icon="itemIconInfo" />
      </div>

      <!-- 右侧表单配置 -->
      <div class="flex-1 min-w-0">
        <!-- 文字模式 -->
        <div v-if="itemIconInfo.itemType === 1">
          <div class="text-xs text-slate-400 dark:text-zinc-400 mb-1">
            {{ $t('common.textContent') || '图标显示文字' }}
          </div>
          <NInput v-model:value="itemIconInfo.text" size="small" type="text" placeholder="如：GPT" @input="handleChange" />
        </div>

        <!-- 在线图标模式 (Iconify) -->
        <div v-if="itemIconInfo.itemType === 3" class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between text-xs text-slate-400 dark:text-zinc-400">
            <span>{{ $t('iconItem.onlineIcon') }} (Iconify 名称)</span>
            <a target="_blank" href="https://icon-sets.iconify.design/" class="text-sky-400 hover:underline flex items-center gap-0.5">
              <span>{{ $t('iconItem.onlineIconLibrary') }}</span>
              <SvgIcon icon="tabler:external-link" class="text-[11px]" />
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
          <div class="flex gap-2">
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
                  <SvgIcon icon="tabler:cloud-upload" />
                </template>
                {{ $t('iconItem.selectUpload') }}
              </NButton>
            </NUpload>
            <NButton size="small" secondary @click="showGallery = true">
              <template #icon>
                <SvgIcon icon="tabler:photo-search" />
              </template>
              {{ $t('iconItem.selectFromGallery') }}
            </NButton>
          </div>
        </div>

        <!-- 背景色调节 -->
        <div class="flex items-center gap-2.5 mt-3 pt-2.5 border-t border-white/10 dark:border-white/10">
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
  background: rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(0, 0, 0, 0.06);
  gap: 3px;
}

html.dark .type-selector-bar {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
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
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

html.dark .type-pill-btn {
  color: #94a3b8;
}

.type-pill-btn:hover {
  color: #0284c7;
  background: rgba(2, 132, 199, 0.06);
}

html.dark .type-pill-btn:hover {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.08);
}

.type-pill-btn.active {
  background: #0284c7;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(2, 132, 199, 0.25);
}

html.dark .type-pill-btn.active {
  background: #38bdf8;
  color: #0f172a;
  box-shadow: 0 2px 10px rgba(56, 189, 248, 0.35);
  font-weight: 600;
}

.icon-preview-frame {
  width: 68px;
  height: 68px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1.5px solid rgba(56, 189, 248, 0.35);
  background: rgba(56, 189, 248, 0.05);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

html:not(.dark) .icon-preview-frame {
  border-color: rgba(2, 132, 199, 0.25);
  background: rgba(2, 132, 199, 0.04);
}
</style>
