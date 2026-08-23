<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FormInst, FormRules } from 'naive-ui'
import { NButton, NForm, NFormItem, NGrid, NGridItem, NInput, NInputGroup, NModal, NSelect, useMessage } from 'naive-ui'
import IconEditor from './IconEditor.vue'
import { edit, getSiteFavicon } from '@/api/panel/itemIcon'
import { getList as getGroupList } from '@/api/panel/itemIconGroup'
import { t } from '@/locales'

interface Props {
  visible: boolean
  itemInfo: Panel.Info | null
  itemGroupId?: number
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()
const ms = useMessage()
const submitLoading = ref(false)
const getIconLoading = ref([false, false])
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
  (e: 'done', item: Panel.Info, meta: { queued: boolean, conflict: boolean }): void// 创建完成
}

const model = ref<Panel.Info>(props.itemInfo ? { ...props.itemInfo } : { ...restoreDefault })
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

async function editApi() {
  submitLoading.value = true
  try {
    const payload = { ...model.value }
    delete (payload as any).revision
    const { code, data, msg, queued, conflict } = await edit<Panel.ItemInfo>(payload)
    if (code === 0) {
      show.value = false
      model.value = { ...restoreDefault }
      if (queued)
        ms.info(conflict ? t('iconItem.queuedWithConflict') : t('iconItem.queuedOffline'))
      else
        ms.success(t('common.saveSuccess'))
      emit('done', data || payload, { queued: Boolean(queued), conflict: Boolean(conflict) })
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

const handleValidateButtonClick = (e: MouseEvent) => {
  e.preventDefault()
  formRef.value?.validate((errors) => {
    if (!errors)
      editApi()
  })
}

async function getIconByUrl(url: string, loadingIndex: number) {
  getIconLoading.value[loadingIndex] = true
  try {
    const { code, data } = await getSiteFavicon<{ iconUrl: string; iconUrls?: string[] }>(url)
    if (code === 0) {
      // CARD-07: 如果有多个候选图标，提示用户选择
      if (data.iconUrls && data.iconUrls.length > 1) {
        ms.info(t('iconItem.multipleIconsFound', { count: data.iconUrls.length }))
      }
      model.value.icon = {
        itemType: 2,
        src: data.iconUrl,
      }
    }
    else {
      ms.error(t('iconItem.geticonFail'))
    }
  }
  catch {
    ms.error(t('iconItem.geticonFail'))
  }
  getIconLoading.value[loadingIndex] = false
}

watch(() => props.visible, (newValue) => {
  if (newValue === true) {
    model.value = props.itemInfo ? { ...props.itemInfo } : { ...restoreDefault }
    if (props.itemGroupId)
      model.value.itemIconGroupId = props.itemGroupId
  }

  getGroupListOptions()
}, { immediate: true })

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
  <NModal
    v-model:show="show"
    preset="card"
    size="small"
    class="edit-item-glass-modal"
    style="width: min(620px, calc(100vw - 24px)); max-height: min(720px, calc(100vh - 32px)); display: flex; flex-direction: column; overflow: hidden;"
    header-style="padding: 14px 20px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); flex-shrink: 0;"
    content-style="padding: 16px 20px; flex: 1 1 0%; min-height: 0; overflow-y: auto; overscroll-behavior: contain;"
    footer-style="padding: 12px 20px 14px; border-top: 1px solid rgba(255, 255, 255, 0.08); flex-shrink: 0;"
    :bordered="false"
    :title="itemInfo ? t('iconItem.edit') : t('iconItem.add')"
  >
    <div class="edit-item-content">
      <NForm ref="formRef" :model="model" :rules="rules" size="small">
        <!-- 基础信息 (分组 & 标题) -->
        <div class="form-glass-card mb-3.5">
          <div class="card-section-title">
            {{ t('common.basicInfo') || '基础信息' }}
          </div>
          <NGrid cols="2" :x-gap="12" item-responsive class="mt-2">
            <NGridItem span="2 500:1">
              <NFormItem path="itemIconGroupId" :label="t('iconItem.iconGroup')" :show-feedback="false">
                <NSelect v-model:value="model.itemIconGroupId" :options="itemIconGroupOptions" />
              </NFormItem>
            </NGridItem>
            <NGridItem span="2 500:1">
              <NFormItem path="title" :label="$t('common.title')" :show-feedback="false">
                <NInput v-model:value="model.title" type="text" show-count :maxlength="20" placeholder="请输入名称" />
              </NFormItem>
            </NGridItem>
          </NGrid>
        </div>

        <!-- 图标定制区 -->
        <div class="form-glass-card mb-3.5">
          <div class="card-section-title">
            {{ $t('common.icon') }}
          </div>
          <div class="mt-2">
            <IconEditor v-model:item-icon="model.icon" />
          </div>
        </div>

        <!-- 链接配置区 -->
        <div class="form-glass-card mb-3.5">
          <div class="card-section-title">
            {{ t('iconItem.url') }}
          </div>
          <div class="flex flex-col gap-2.5 mt-2">
            <NFormItem path="url" :label="$t('iconItem.url')" :show-feedback="false">
              <NInputGroup>
                <NInput v-model:value="model.url" type="text" :maxlength="1000" placeholder="外网链接 (如 https://...)" />
                <NButton :disabled="!model.url" :loading="getIconLoading[0]" type="primary" secondary @click="getIconByUrl(model.url, 0)">
                  {{ $t('iconItem.getIcon') }}
                </NButton>
              </NInputGroup>
            </NFormItem>
            <NFormItem path="lanUrl" :label="$t('iconItem.lanUrl')" :show-feedback="false">
              <NInputGroup>
                <NInput v-model:value="model.lanUrl" type="text" :maxlength="1000" :placeholder="$t('iconItem.lanUrlInputPlaceholder')" />
                <NButton :disabled="!model.lanUrl" :loading="getIconLoading[1]" type="primary" secondary @click="getIconByUrl(model.lanUrl || '', 1)">
                  {{ $t('iconItem.getIcon') }}
                </NButton>
              </NInputGroup>
            </NFormItem>
          </div>
        </div>

        <!-- 详细选项区 -->
        <div class="form-glass-card">
          <div class="card-section-title">
            {{ t('apps.baseSettings.other') || '其他设置' }}
          </div>
          <div class="flex flex-col gap-2.5 mt-2">
            <NFormItem path="description" :label="$t('common.description')" :show-feedback="false">
              <NInput v-model:value="model.description" type="text" show-count :maxlength="100" placeholder="项目简短描述" />
            </NFormItem>
            <NFormItem path="openMethod" :label="$t('iconItem.openMethod')" :show-feedback="false">
              <NSelect v-model:value="model.openMethod" :options="options" />
            </NFormItem>
          </div>
        </div>
      </NForm>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2.5 w-full">
        <NButton @click="show = false">
          {{ t('common.cancel') }}
        </NButton>
        <NButton type="primary" :loading="submitLoading" @click="handleValidateButtonClick">
          {{ $t('common.save') }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style>
/* Edit Item Frosted Glass Modal */
.edit-item-glass-modal.n-card {
  margin: auto !important;
  border-radius: 20px !important;
  background: rgba(18, 20, 26, 0.84) !important;
  backdrop-filter: blur(28px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(28px) saturate(190%) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08) inset !important;
}

html:not(.dark) .edit-item-glass-modal.n-card {
  background: rgba(255, 255, 255, 0.88) !important;
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.8) inset !important;
}

.edit-item-glass-modal .form-glass-card {
  border-radius: 12px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

html:not(.dark) .edit-item-glass-modal .form-glass-card {
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.edit-item-glass-modal .card-section-title {
  font-size: 12px;
  font-weight: 600;
  color: #38bdf8;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

html:not(.dark) .edit-item-glass-modal .card-section-title {
  color: #0284c7;
}

.edit-item-glass-modal .n-form-item {
  margin-bottom: 8px;
}

.edit-item-glass-modal .n-form-item:last-child {
  margin-bottom: 0;
}
</style>
