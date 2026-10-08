<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { NButton, NInput, NModal, NSelect, NUpload, useMessage } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import GroupIcon from '@/components/common/GroupIcon/index.vue'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import { GROUP_ICON_CATEGORIES, GROUP_ICON_PRESETS, decodeGroupAppearance, encodeGroupAppearance, filterGroupIcons, isGroupImageSource } from '@/icons/groupAppearance'
import type { GroupAppearance } from '@/icons/groupAppearance'
import GroupOrderPanel from './GroupOrderPanel.vue'
import { edit } from '@/api/panel/itemIconGroup'
import { useAuthStore } from '@/store'
import { getRuntime } from '@/runtime'

const props = defineProps<{ groups: Panel.ItemIconGroup[] }>()
const emit = defineEmits<{
  (event: 'saved', group: Panel.ItemIconGroup, meta: { queued: boolean }): void
  (event: 'orderSaved', ids: number[], meta: { queued: boolean }): void
}>()
const GallerySelector = defineAsyncComponent(() => import('@/components/common/GallerySelector/index.vue'))
const auth = useAuthStore()
const runtime = getRuntime()
const message = useMessage()
const selectedId = ref<number | null>(null)
const draft = ref<GroupAppearance>({ mode: 'builtin', value: GROUP_ICON_PRESETS[0].icon })
const saving = ref(false)
const uploading = ref(false)
const showGallery = ref(false)
const iconCategory = ref('全部')
const iconQuery = ref('')
const visibleIcons = computed(() => filterGroupIcons(iconCategory.value, iconQuery.value))
let uploadAccountId: number | undefined
let uploadOrigin: string | null = null
const selected = computed(() => props.groups.find(group => group.id === selectedId.value))
const groupOptions = computed(() => props.groups.map(group => ({ label: group.title || '未命名分组', value: group.id as number })))
const previewIcon = computed(() => {
  try { return encodeGroupAppearance(draft.value) }
  catch { return 'material-symbols-folder-outline' }
})
watch(() => props.groups.map(group => group.id), ids => {
  if (!ids.includes(selectedId.value ?? undefined)) selectedId.value = ids[0] ?? null
}, { immediate: true })
function reset() { draft.value = decodeGroupAppearance(selected.value?.icon) }
watch(selectedId, reset, { immediate: true })
function changeMode(mode: GroupAppearance['mode']) {
  draft.value = { mode, value: mode === 'text' ? Array.from(selected.value?.title || 'A').slice(0, 2).join('') : mode === 'image' ? '' : GROUP_ICON_PRESETS[0].icon }
}
function chooseImage(url: string) {
  if (!isGroupImageSource(url)) {
    message.error('图片地址无效或过长，请选择其他图片')
    return
  }
  draft.value = { mode: 'image', value: url }
  showGallery.value = false
}
function beforeUpload({ file }: { file: UploadFileInfo }) {
  if (!auth.token || !file.file) return false
  if (file.file.size > 2 * 1024 * 1024 || !/\.(?:png|jpe?g|webp|gif|svg|ico|avif)$/i.test(file.name)) {
    message.error('请选择不超过 2 MB 的图片')
    return false
  }
  uploadAccountId = auth.userInfo?.id
  uploadOrigin = runtime.getServerOrigin()
  uploading.value = true
  return true
}
function uploadFinish({ event }: { event?: ProgressEvent }) {
  uploading.value = false
  try {
    if (auth.userInfo?.id !== uploadAccountId || runtime.getServerOrigin() !== uploadOrigin || !auth.token)
      throw new Error('账号或服务器已切换，请重新上传')
    const result = JSON.parse((event?.target as XMLHttpRequest)?.response || '{}')
    if (result.code !== 0 || typeof result.data?.imageUrl !== 'string') throw new Error('上传失败，请重试')
    chooseImage(result.data.imageUrl)
  }
  catch (error) { message.error(error instanceof Error ? error.message : '上传失败') }
}
function uploadError() { uploading.value = false; message.error('上传失败，请检查网络后重试') }
async function save() {
  const group = selected.value
  if (!group?.id || !auth.token || saving.value || uploading.value) return
  const accountId = auth.userInfo?.id
  const origin = runtime.getServerOrigin()
  saving.value = true
  try {
    const payload: Panel.ItemIconGroup = { id: group.id, title: group.title, description: group.description, sort: group.sort, icon: encodeGroupAppearance(draft.value) }
    const result = await edit<Panel.ItemIconGroup>(payload)
    if (result.code !== 0) throw new Error(result.msg || '保存失败')
    if (auth.userInfo?.id !== accountId || runtime.getServerOrigin() !== origin || !auth.token)
      throw new Error('账号或服务器已切换，请刷新当前页面')
    emit('saved', { ...payload, ...result.data }, { queued: Boolean(result.queued) })
    if (result.queued) message.info(result.conflict ? '分组图标已保存到待同步队列，请处理云端冲突' : '分组图标已保存到待同步队列，联网后同步')
    else message.success('分组图标已保存并同步')
  }
  catch (error) { message.error(error instanceof Error ? error.message : '保存失败，请重试') }
  finally { saving.value = false }
}
</script>

<template>
  <section class="group-appearance-panel">
    <GroupOrderPanel :groups="groups" @saved="(ids, meta) => emit('orderSaved', ids, meta)" />
    <div class="group-appearance-heading">
      <h3>分组外观</h3><p>为每个分组选择标志，保存后同步到同账号的其他设备。</p>
    </div>
    <p v-if="!auth.token" class="group-appearance-hint">
      登录后可修改分组图标，访客仍可使用默认分组。
    </p>
    <template v-else-if="selected">
      <NSelect v-model:value="selectedId" :options="groupOptions" :disabled="saving || uploading" aria-label="选择要设置图标的分组" />
      <div class="group-appearance-layout">
        <div class="group-appearance-editor">
          <div class="group-icon-modes" role="group" aria-label="分组图标类型">
            <button v-for="mode in (['builtin', 'text', 'image'] as const)" :key="mode" type="button" :class="{ active: draft.mode === mode }" :aria-pressed="draft.mode === mode" :disabled="saving || uploading" @click="changeMode(mode)">
              {{ { builtin: '内置图标', text: '文字标记', image: '自定义图片' }[mode] }}
            </button>
          </div>
          <div v-if="draft.mode === 'builtin'" class="group-icon-library">
            <NInput v-model:value="iconQuery" placeholder="搜索图标，如 NAS、音乐、server" aria-label="搜索内置分组图标" clearable />
            <div class="group-icon-categories" role="group" aria-label="图标分类">
              <button v-for="category in ['全部', ...GROUP_ICON_CATEGORIES]" :key="category" type="button" :aria-pressed="iconCategory === category" :class="{ active: iconCategory === category }" @click="iconCategory = category">
                {{ category }}
              </button>
            </div>
            <small class="group-icon-count">{{ visibleIcons.length }} 个图标 · 已选：{{ GROUP_ICON_PRESETS.find(item => item.icon === draft.value)?.label || '原有图标' }}</small>
            <div v-if="visibleIcons.length" class="group-icon-presets">
              <button v-for="preset in visibleIcons" :key="preset.icon" type="button" :aria-label="preset.label" :aria-pressed="draft.value === preset.icon" :title="preset.label" :class="{ active: draft.value === preset.icon }" :disabled="saving || uploading" @click="draft.value = preset.icon">
                <SvgIcon :icon="preset.icon" /><span>{{ preset.label }}</span>
              </button>
            </div>
            <p v-else class="group-appearance-hint">
              没有匹配的图标，请试试其他关键词或切换到全部分类。
            </p>
          </div>
          <div v-else-if="draft.mode === 'text'" class="group-text-editor">
            <NInput v-model:value="draft.value" :disabled="saving" placeholder="输入 1–2 个字符，如 PT、工" aria-label="分组文字标记" /><small>支持汉字、字母和 Emoji，最多两个字符。</small>
          </div>
          <div v-else class="group-image-editor">
            <NInput v-model:value="draft.value" :disabled="saving || uploading" placeholder="图片地址，或使用下方上传与图库" aria-label="分组图片地址" />
            <div class="group-image-actions">
              <NUpload :action="runtime.resolveUrl('/api/file/uploadImg')" :show-file-list="false" :disabled="saving || uploading" accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.ico,.avif" name="imgfile" :data="{ fileType: 'icon' }" :headers="{ Authorization: `Bearer ${auth.token}`, token: auth.token || '' }" :on-before-upload="beforeUpload" @finish="uploadFinish" @error="uploadError">
                <NButton :loading="uploading" :disabled="saving">
                  上传图片
                </NButton>
              </NUpload>
              <NButton :disabled="saving || uploading" @click="showGallery = true">
                从图库选择
              </NButton>
            </div>
            <small>不超过 2 MB，上传的图片也会展示在图库素材中心。</small>
          </div>
        </div>
        <aside class="group-icon-preview">
          <small>侧边栏预览</small><GroupIcon :icon="previewIcon" :title="selected.title" :size="40" /><strong>{{ selected.title }}</strong>
        </aside>
      </div>
      <div class="group-appearance-actions">
        <NButton type="primary" :loading="saving" :disabled="uploading" @click="save">
          保存分组图标
        </NButton><NButton :disabled="saving || uploading" @click="reset">
          还原修改
        </NButton>
      </div>
    </template>
    <p v-else class="group-appearance-hint">
      暂无分组，请先在侧边栏新增一个分组。
    </p>
    <NModal v-model:show="showGallery" preset="card" to=".pn-theme-root" class="round-card-modal" title="选择分组图标" style="width: min(720px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow-y: auto;">
      <GallerySelector v-if="showGallery" type="icon" @select="chooseImage" />
    </NModal>
  </section>
</template>

<style scoped>
.group-appearance-panel { display: grid; gap: 18px; padding: 24px; margin-top: 20px; border-radius: 20px; border: 1px solid var(--pn-glass-border); background: var(--pn-glass-panel); }
.group-appearance-heading h3 { margin: 0 0 8px; color: var(--pn-color-text-primary); font-size: 16px; }
.group-appearance-heading p, .group-appearance-hint { margin: 0; color: var(--pn-color-text-muted); font-size: 12px; line-height: 1.6; }
.group-appearance-layout { display: grid; grid-template-columns: minmax(0, 1fr) 140px; gap: 20px; align-items: start; }
.group-appearance-editor { min-width: 0; display: grid; gap: 16px; }
.group-icon-modes { display: flex; padding: 4px; gap: 4px; border-radius: 12px; background: var(--pn-glass-control); border: 1px solid var(--pn-glass-border); }
.group-icon-modes button { flex: 1; padding: 8px 4px; border: 0; border-radius: 8px; color: var(--pn-color-text-secondary); background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.group-icon-modes button.active { background: var(--pn-color-accent); color: var(--pn-color-surface); }
.group-icon-library { display: grid; gap: 12px; min-width: 0; }
.group-icon-categories { display: flex; flex-wrap: wrap; gap: 6px; }
.group-icon-categories button { padding: 6px 9px; border: 1px solid var(--pn-glass-border); border-radius: 8px; background: var(--pn-glass-control); color: var(--pn-color-text-secondary); font-size: 11px; cursor: pointer; }
.group-icon-categories button.active { background: var(--pn-color-accent); color: var(--pn-color-surface); }
.group-icon-count { font-size: 11px; color: var(--pn-color-text-muted); }
.group-icon-presets { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); grid-auto-rows: 64px; align-content: start; gap: 8px; max-height: 280px; min-width: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 3px; }
.group-icon-presets button { gap: 6px; }
.group-icon-presets span { font-size: 10px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-icon-presets button { display: grid; grid-template-rows: 22px 14px; align-content: center; place-items: center; box-sizing: border-box; min-width: 0; height: 64px; padding: 8px 4px; overflow: hidden; border: 1px solid var(--pn-glass-border); border-radius: 10px; background: var(--pn-glass-control); color: var(--pn-color-text-secondary); cursor: pointer; }
.group-icon-presets button.active { border-color: var(--pn-color-accent); color: var(--pn-color-accent); }
.group-icon-presets svg { width: 22px; height: 22px; }
.group-icon-preview { display: grid; justify-items: center; gap: 14px; padding: 18px 10px; border-radius: 14px; background: var(--pn-glass-control); color: var(--pn-color-text-primary); }
.group-icon-preview strong { font-size: 12px; max-width: 100%; overflow-wrap: anywhere; text-align: center; }
.group-icon-preview small, .group-image-editor small, .group-text-editor small { color: var(--pn-color-text-muted); font-size: 11px; line-height: 1.6; }
.group-image-editor, .group-text-editor { display: grid; gap: 10px; }
.group-image-actions, .group-appearance-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.group-image-actions :deep(.n-upload) { width: auto; }
button:not(.n-button):disabled { cursor: not-allowed; opacity: .6; }
button:not(.n-button):focus-visible { outline: 2px solid var(--pn-color-accent); outline-offset: 2px; }
@media (max-width: 760px) { .group-appearance-layout { grid-template-columns: minmax(0, 1fr); } .group-icon-preview { grid-row: 1; grid-template-columns: 1fr auto 1fr; align-items: center; } .group-icon-presets { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
</style>
