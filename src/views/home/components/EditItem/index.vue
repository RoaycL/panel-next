<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { FormInst, FormRules } from 'naive-ui'
import { NButton, NCard, NForm, NFormItem, NGrid, NGridItem, NInput, NInputGroup, NModal, NSelect, useMessage } from 'naive-ui'
import IconEditor from './IconEditor.vue'
import { cacheSavedIconImage } from '@/icons/localImageCache'
import { edit, getSiteFavicon } from '@/api/panel/itemIcon'
import { getList as getGroupList } from '@/api/panel/itemIconGroup'
import { t } from '@/locales'
import { createPresetIcon, findIconPresetForUrl } from '@/icons/presets'
import { getRuntime } from '@/runtime'
import ItemIcon from '@/components/common/ItemIcon/index.vue'

interface Props {
  visible: boolean
  itemInfo: Panel.Info | null
  itemGroupId?: number
  embedded?: boolean
  title?: string
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()
const ms = useMessage()
const runtime = getRuntime()
const modalTo = runtime.kind === 'extension' ? '.pn-theme-root' : undefined
const submitLoading = ref(false)
const getIconLoading = ref([false, false])
let iconRequestGeneration = 0
onBeforeUnmount(() => { iconRequestGeneration++ })
const itemIconGroupOptions = ref<{
  label: string
  value: number
}[]>([])

const restoreDefault: Panel.Info = {
  icon: null,
  title: '',
  url: '',
  lanUrl: '',
  description: '',
  openMethod: 2,
}

interface Emit {
  (e: 'update:visible', visible: boolean): void
  (e: 'done', item: Panel.Info, meta: { queued: boolean, conflict: boolean, keepOpen: boolean }): void// 创建完成
  (e: 'busy', value: boolean): void
}

function newItemModel(): Panel.Info {
  return { ...restoreDefault, ...(props.embedded ? { icon: { itemType: 1, text: 'A', backgroundColor: '#168eff' } } : {}) }
}
const model = ref<Panel.Info>(props.itemInfo ? { ...props.itemInfo } : newItemModel())
const formRef = ref<FormInst | null>(null)

const rules: FormRules = {
  title: {
    required: true,
    trigger: 'blur',
    message: t('form.required'),
  },
  url: {
    required: true,
    trigger: 'blur',
    type: 'string',
    message: t('form.required'),
  },
  // itemIconGroupId: {
  //   required: true,
  //   trigger: ['blur', 'change'],
  //   message: t('form.required'),
  // },
}

const options = [
  {
    default: true,
    label: t('iconItem.currentPageOpen'),
    value: 1,
  },
  {
    label: t('iconItem.newWindowOpen'),
    value: 2,
  },
  {
    label: t('iconItem.currentPageLayerOpen'),
    value: 3,
  },
]

// 更新值父组件传来的值
const show = computed({
  get: () => props.visible,
  set: (visible: boolean) => {
    emit('update:visible', visible)
  },
})

watch(submitLoading, value => emit('busy', value))

async function editApi(keepOpen = false) {
  if (submitLoading.value)
    return
  submitLoading.value = true
  try {
    const payload = { ...model.value }
    delete (payload as any).revision
    const iconSource = payload.icon?.itemType === 2 ? payload.icon.src?.trim() : ''
    const previousSource = props.itemInfo?.icon?.itemType === 2 ? props.itemInfo.icon.src?.trim() : ''
    let iconCacheTask: Promise<boolean> | null = null
    if (iconSource && iconSource !== previousSource) {
      try {
        const resolved = new URL(runtime.resolveUrl(iconSource), `${runtime.getServerOrigin() || window.location.origin}/`)
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:')
          iconCacheTask = cacheSavedIconImage(resolved.href)
      }
      catch { /* Invalid or non-network icon sources keep their normal fallback. */ }
    }
    const { code, data, msg, queued, conflict } = await edit<Panel.ItemInfo>(payload)
    if (code === 0) {
      if (iconCacheTask && navigator.onLine && !await iconCacheTask)
        ms.warning(t('iconItem.localCacheUnavailable'))
      if (!keepOpen)
        show.value = false
      model.value = { ...newItemModel(), itemIconGroupId: props.itemGroupId ?? model.value.itemIconGroupId }
      // Queued edits sync silently; a real conflict opens the resolver.
      if (!queued)
        ms.success(t('common.saveSuccess'))
      emit('done', data || payload, { queued: Boolean(queued), conflict: Boolean(conflict), keepOpen })
    }
    else {
      ms.error(`${t('common.saveFail')}:${msg}`)
    }
  }
  catch {
    ms.error(t('common.saveFail'))
  }
  submitLoading.value = false
}

const handleValidateButtonClick = async (e: MouseEvent, keepOpen = false) => {
  e.preventDefault()
  if (submitLoading.value || !formRef.value)
    return
  try {
    await formRef.value.validate()
  }
  catch {
    ms.error(t('iconGallery.requiredFields'))
    return
  }
  await editApi(keepOpen)
}

async function getIconByUrl(url: string, loadingIndex: number) {
  if (getIconLoading.value.some(Boolean))
    return
  const generation = ++iconRequestGeneration
  // Always ask the site first; the bundled mark is only a fallback.
  const preset = findIconPresetForUrl(url)
  getIconLoading.value[loadingIndex] = true
  try {
    const { code, data, msg } = await getSiteFavicon<{ iconUrl: string; iconUrls?: string[] }>(url)
    if (generation !== iconRequestGeneration || !props.visible || url !== (loadingIndex === 0 ? model.value.url : model.value.lanUrl))
      return
    if (code === 0 && data?.iconUrl) {
      model.value.icon = {
        itemType: 2,
        src: data.iconUrl,
      }
      ms.success('已获取网站图标')
    }
    else if (preset) {
      model.value.icon = createPresetIcon(preset)
      ms.warning('网站图标获取失败，已使用内置图标')
    }
    else {
      ms.error(msg || t('iconItem.geticonFail'))
    }
  }
  catch {
    if (generation !== iconRequestGeneration || !props.visible)
      return
    if (preset) {
      model.value.icon = createPresetIcon(preset)
      ms.warning('网站图标获取失败，已使用内置图标')
    }
    else {
      ms.error('获取图标超时或服务不可达，请重试，也可以上传图片。内网地址需要服务器能够访问。')
    }
  }
  finally {
    if (generation === iconRequestGeneration)
      getIconLoading.value[loadingIndex] = false
  }
}

watch([() => props.visible, () => props.itemInfo], ([newValue]) => {
  iconRequestGeneration++
  getIconLoading.value = [false, false]
  if (newValue === true) {
    model.value = props.itemInfo ? { ...props.itemInfo } : newItemModel()
    if (props.itemGroupId)
      model.value.itemIconGroupId = props.itemGroupId
  }

  getGroupListOptions()
}, { immediate: true })

watch(() => props.itemGroupId, (id) => {
  if (props.embedded && id)
    model.value.itemIconGroupId = id
})

const frameProps = computed(() => props.embedded
  ? { bordered: false, contentStyle: 'padding: 0;', footerStyle: 'padding: 16px 0 0;' }
  : {
      show: show.value,
      'onUpdate:show': (value: boolean) => { show.value = value },
      to: modalTo,
      preset: 'card' as const,
      size: 'small' as const,
      style: 'width: min(680px, calc(100vw - 24px)); max-height: min(760px, calc(100vh - 32px)); display: flex; flex-direction: column; overflow: hidden;',
      headerStyle: 'padding: 14px 20px 12px; border-bottom: 1px solid rgba(255,255,255,.08); flex-shrink: 0;',
      contentStyle: 'padding: 14px 20px; flex: 1 1 0%; min-height: 0; overflow-y: auto; overscroll-behavior: contain;',
      footerStyle: 'padding: 12px 20px 14px; border-top: 1px solid rgba(255,255,255,.08); flex-shrink: 0;',
      bordered: false,
      title: props.title || (props.itemInfo?.id ? t('iconItem.edit') : t('iconItem.add')),
    })

async function getGroupListOptions() {
  try {
    const { data, code, msg } = await getGroupList<Common.ListResponse<Panel.ItemIconGroup[]>>()
    if (code === 0) {
      itemIconGroupOptions.value = []

      for (let i = 0; i < data.list.length; i++) {
        const element = data.list[i]
        if (i === 0 && !model.value.itemIconGroupId) {
          model.value.itemIconGroupId = element.id
          restoreDefault.itemIconGroupId = element.id
        }

        itemIconGroupOptions.value.push({
          value: element.id as number,
          label: element.title as string,
        })
      }
    }
    else {
      ms.error(`${t('iconItem.getGroupFail')}:${msg}`)
    }
  }
  catch {
    // 离线时保留当前分组选项，既有修改仍可入队；在线失败则给出提示。
    if (navigator.onLine)
      ms.error(t('iconItem.getGroupFail'))
    itemIconGroupOptions.value = model.value.itemIconGroupId
      ? [{ value: model.value.itemIconGroupId, label: t('iconItem.currentGroupOffline') }]
      : []
  }
}
</script>

<template>
  <component
    :is="embedded ? NCard : NModal"
    v-bind="frameProps"
    :class="embedded ? 'edit-item-glass-modal edit-item-embedded' : 'edit-item-glass-modal'"
  >
    <div class="edit-item-content" :class="{ 'custom-icon-layout': embedded }">
      <NForm ref="formRef" :model="model" :rules="rules" size="small">
        <!-- 基础信息 (分组 & 标题) -->
        <div class="form-glass-card mb-3">
          <div class="card-section-title">
            {{ t('common.basicInfo') }}
          </div>
          <NFormItem path="url" :label="$t('iconItem.url')" :show-feedback="embedded">
            <NInputGroup>
              <NInput v-model:value="model.url" type="text" :maxlength="1000" placeholder="https://example.com" />
              <NButton :disabled="!model.url" :loading="getIconLoading[0]" :type="embedded ? undefined : 'primary'" secondary @click="getIconByUrl(model.url, 0)">
                {{ $t('iconItem.getIcon') }}
              </NButton>
            </NInputGroup>
          </NFormItem>
          <NGrid cols="2" :x-gap="12" item-responsive class="mt-2">
            <NGridItem v-if="!embedded" span="2 500:1">
              <NFormItem path="itemIconGroupId" :label="t('iconItem.iconGroup')" :show-feedback="false">
                <NSelect v-model:value="model.itemIconGroupId" :options="itemIconGroupOptions" />
              </NFormItem>
            </NGridItem>
            <NGridItem :span="embedded ? 2 : '2 500:1'">
              <NFormItem path="title" :label="$t('common.title')" :show-feedback="embedded">
                <NInput v-model:value="model.title" type="text" show-count :maxlength="20" placeholder="请输入名称" />
              </NFormItem>
            </NGridItem>
          </NGrid>
        </div>

        <!-- 图标定制区 -->
        <div class="form-glass-card mb-3">
          <div class="card-section-title">
            {{ $t('common.icon') }}
          </div>
          <div class="mt-2">
            <IconEditor v-model:item-icon="model.icon" :fallback-text="model.title" :site-url="model.url" :show-preview="!embedded" />
          </div>
        </div>

        <!-- 详细选项区 -->
        <!-- 内网地址、描述和打开方式不常改，默认收起，让常用项一屏放下。 -->
        <details class="form-glass-card edit-item-advanced">
          <summary class="card-section-title">
            {{ embedded ? t('iconGallery.advanced') : t('iconItem.otherSettings') }}
          </summary>
          <div class="flex flex-col gap-2.5 mt-2">
            <NFormItem path="lanUrl" :label="$t('iconItem.lanUrl')" :show-feedback="false">
              <NInputGroup>
                <NInput v-model:value="model.lanUrl" :maxlength="1000" :placeholder="$t('iconItem.lanUrlInputPlaceholder')" />
                <NButton v-if="!embedded" :disabled="!model.lanUrl" :loading="getIconLoading[1]" type="primary" secondary @click="getIconByUrl(model.lanUrl || '', 1)">
                  {{ $t('iconItem.getIcon') }}
                </NButton>
              </NInputGroup>
            </NFormItem>
            <NFormItem path="description" :label="$t('common.description')" :show-feedback="false">
              <NInput v-model:value="model.description" type="text" show-count :maxlength="100" placeholder="项目简短描述" />
            </NFormItem>
            <NFormItem path="openMethod" :label="$t('iconItem.openMethod')" :show-feedback="false">
              <NSelect v-model:value="model.openMethod" :options="options" />
            </NFormItem>
          </div>
        </details>
      </NForm>
      <aside v-if="embedded" class="custom-icon-preview" aria-label="图标实时预览">
        <span class="custom-preview-label">实时预览</span>
        <div class="custom-preview-stage">
          <ItemIcon :item-icon="model.icon" :fallback-text="model.title" :site-url="model.url" :size="80" :cache-delay="450" />
          <strong>{{ model.title || '网站名称' }}</strong>
          <span>{{ model.description || '你的专属快捷入口' }}</span>
        </div>
        <p class="custom-preview-address">
          {{ model.url || 'https://example.com' }}
        </p>
        <p class="custom-preview-note">
          预览与桌面使用相同的图标样式，自动适配日间与夜间主题。
        </p>
      </aside>
    </div>

    <template #footer>
      <div class="edit-item-actions flex items-center justify-end gap-2.5 w-full">
        <NButton v-if="!embedded" :disabled="submitLoading" @click="show = false">
          {{ t('common.cancel') }}
        </NButton>
        <NButton type="primary" :loading="submitLoading" @click="handleValidateButtonClick($event)">
          {{ $t('common.save') }}
        </NButton>
        <NButton v-if="embedded && !itemInfo?.id" secondary type="primary" :disabled="submitLoading" @click="handleValidateButtonClick($event, true)">
          {{ t('iconGallery.saveContinue') }}
        </NButton>
      </div>
    </template>
  </component>
</template>

<style>
/* Edit Item Frosted Glass Modal */
.edit-item-glass-modal.n-card {
  margin: auto !important;
  border-radius: var(--pn-radius-large, 20px) !important;
  color: var(--pn-modal-content-text-color, var(--pn-color-text-secondary, inherit)) !important;
  background: var(--pn-modal-background, rgba(18, 20, 26, 0.96)) !important;
  border: 1px solid var(--pn-modal-border, var(--pn-color-border, rgba(255, 255, 255, 0.12))) !important;
  box-shadow: var(--pn-effect-shadow-high, 0 25px 60px -15px rgba(0, 0, 0, 0.65)) !important;
}

.edit-item-glass-modal .form-glass-card {
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--pn-color-surface-hover, rgba(255, 255, 255, 0.035));
  border: 1px solid var(--pn-color-border, rgba(255, 255, 255, 0.08));
}

.edit-item-glass-modal .card-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--pn-color-accent, #38bdf8);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.edit-item-glass-modal .n-form-item {
  margin-bottom: 8px;
}

.edit-item-glass-modal .n-form-item:last-child {
  margin-bottom: 0;
}
.edit-item-embedded.n-card { margin: 0 !important; border: 0 !important; background: transparent !important; box-shadow: none !important; }
.edit-item-embedded .form-glass-card { background: var(--pn-glass-panel); border-color: var(--pn-glass-border); padding: 16px; }
.edit-item-embedded .card-section-title { display: block; margin-bottom: 16px; color: var(--pn-color-text-primary); font-size: 14px; }
.custom-icon-layout { display: grid; grid-template-columns: minmax(0, 1fr) 230px; align-items: start; gap: 22px; }
.custom-icon-layout .n-form { min-width: 0; }
.custom-icon-preview { position: sticky; top: 0; display: grid; gap: 16px; padding: 20px; border: 1px solid var(--pn-glass-border); border-radius: 18px; background: var(--pn-glass-panel); }
.custom-preview-label { color: var(--pn-color-text-muted); font-size: 11px; letter-spacing: .08em; }
.custom-preview-stage { display: flex; min-height: 206px; align-items: center; justify-content: center; flex-direction: column; gap: 12px; padding: 20px 12px; border-radius: 14px; background: var(--pn-glass-control); }
.custom-preview-stage strong { max-width: 100%; overflow-wrap: anywhere; color: var(--pn-color-text-primary); font-size: 14px; text-align: center; }
.custom-preview-stage > span { color: var(--pn-color-text-muted); font-size: 12px; text-align: center; overflow-wrap: anywhere; }
.custom-preview-address { margin: 0; color: var(--pn-color-text-secondary); font-size: 12px; overflow-wrap: anywhere; }
.custom-preview-note { margin: 0; color: var(--pn-color-text-muted); font-size: 11px; line-height: 1.7; }
.edit-item-embedded .edit-item-actions { justify-content: flex-start; padding: 0 4px; }
.edit-item-embedded .edit-item-actions .n-button { min-width: 110px; height: 40px; }
@media (max-width: 850px) {
  .custom-icon-layout { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .custom-icon-preview { position: static; grid-row: 1; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px 16px; padding: 16px; }
  .custom-preview-stage { grid-column: 1; grid-row: 2 / 4; min-height: 130px; padding: 12px; }
  .custom-preview-label { grid-column: 1 / -1; }
  .custom-preview-note { grid-column: 2; }
}
.edit-item-embedded .n-card__footer, .edit-item-embedded .n-card-footer { position: sticky; z-index: 1; bottom: 0; background: var(--pn-glass-panel); border-radius: 12px; backdrop-filter: var(--pn-glass-filter); }
.edit-item-advanced summary { cursor: pointer; }
.edit-item-advanced[open] summary { margin-bottom: 12px; }
</style>
