<script setup lang="ts">
import type { Component } from 'vue'
import { computed, ref, shallowRef, watch } from 'vue'
import { NButton, NInput, NInputNumber, NSelect, NSwitch, useMessage } from 'naive-ui'
import RoundCardModal from '@/components/common/RoundCardModal/index.vue'
import type { WidgetInstance, WidgetSize } from './types'
import { widgetRegistry } from './registry'
import WidgetHost from './WidgetHost.vue'
import { t } from '@/locales'

const props = defineProps<{ show: boolean; instance: WidgetInstance | null }>()
const emit = defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'save', value: WidgetInstance): void
}>()
const ms = useMessage()
const draft = ref<Record<string, unknown>>({})

const definition = computed(() => props.instance ? widgetRegistry.get(props.instance.type) : null)
const fields = computed(() => Object.entries(definition.value?.configSchema.fields ?? {}))
const visible = computed({ get: () => props.show, set: value => emit('update:show', value) })

// Widgets may ship their own editor; it gets a live preview beside it.
const customEditor = shallowRef<Component | null>(null)
const previewSizeIndex = ref(0)
const PREVIEW_SIZES: readonly WidgetSize[] = [
  { columns: 4, rows: 2 }, { columns: 3, rows: 2 }, { columns: 2, rows: 2 },
  { columns: 3, rows: 1 }, { columns: 2, rows: 1 },
]
const previewSizes = computed(() => {
  const size = definition.value?.size
  if (!size)
    return []
  const candidates = size.supportedSizes ?? PREVIEW_SIZES
  return candidates.filter(candidate => candidate.columns >= size.min.columns && candidate.columns <= size.max.columns
    && candidate.rows >= size.min.rows && candidate.rows <= size.max.rows)
})
const previewConfig = shallowRef<unknown>({})
const previewInstance = computed<WidgetInstance | null>(() => {
  if (!props.instance || !previewSizes.value.length)
    return null
  return {
    ...props.instance,
    id: `preview.${props.instance.type}`,
    hidden: false,
    size: previewSizes.value[previewSizeIndex.value % previewSizes.value.length],
    config: previewConfig.value,
  }
})
// The preview keeps the last valid draft while a field is mid-edit.
watch(draft, (value) => {
  try {
    previewConfig.value = definition.value?.configSchema.parse(value) ?? value
  }
  catch {}
}, { deep: true })

watch(() => [props.show, props.instance] as const, ([show, instance]) => {
  if (show && instance) {
    draft.value = JSON.parse(JSON.stringify(instance.config ?? {}))
    const index = previewSizes.value.findIndex(size => size.columns === instance.size.columns && size.rows === instance.size.rows)
    previewSizeIndex.value = Math.max(0, index)
  }
}, { immediate: true, deep: true })

watch(definition, async (value) => {
  customEditor.value = null
  if (value?.settings) {
    const editor = await value.settings()
    if (definition.value === value)
      customEditor.value = editor
  }
}, { immediate: true })

function stepPreview(delta: number) {
  const count = previewSizes.value.length
  previewSizeIndex.value = (previewSizeIndex.value + delta + count) % count
}

function fieldLabel(key: string, label?: string) {
  if (!label?.trim())
    return key
  return t(label)
}

// 与 fieldLabel 一致：description 支持字面文案或 i18n key，统一走翻译回退
function fieldDescription(description?: string) {
  if (!description?.trim())
    return ''
  return t(description)
}

function selectOptions(values?: readonly string[]) {
  return (values ?? []).map(value => ({ label: value, value }))
}

function save() {
  if (!props.instance || !definition.value)
    return
  try {
    const config = definition.value.configSchema.parse(draft.value)
    emit('save', { ...props.instance, config })
    visible.value = false
  }
  catch (error) {
    ms.error(error instanceof Error ? error.message : t('widgetLayout.settings.invalid'))
  }
}
</script>

<template>
  <RoundCardModal v-model:show="visible" class="widget-settings-modal" :title="t('widgetLayout.settings.title')" :style="{ width: customEditor ? 'min(900px, calc(100vw - 24px))' : 'min(520px, calc(100vw - 24px))' }" content-style="min-height: 0; overflow-y: auto;">
    <div v-if="instance && customEditor" class="widget-settings-split">
      <section class="widget-settings-preview" :aria-label="t('widgetLayout.settings.preview')">
        <span class="widget-settings-preview-title">{{ t('widgetLayout.settings.preview') }}</span>
        <div class="widget-settings-stage">
          <div
            v-if="previewInstance" class="widget-settings-frame"
            :style="{ width: `${previewInstance.size.columns * 80 + (previewInstance.size.columns - 1) * 12}px`, height: `${previewInstance.size.rows * 90 + (previewInstance.size.rows - 1) * 10}px` }"
          >
            <WidgetHost :instance="previewInstance" edit-mode />
          </div>
        </div>
        <div v-if="previewSizes.length > 1" class="widget-settings-sizes">
          <button type="button" :aria-label="t('widgetLayout.settings.previousSize')" @click="stepPreview(-1)">
            ‹
          </button>
          <span class="widget-settings-dots">
            <i v-for="(size, index) in previewSizes" :key="`${size.columns}x${size.rows}`" :class="{ 'is-on': index === previewSizeIndex }" />
          </span>
          <span class="widget-settings-size">{{ previewInstance?.size.columns }}×{{ previewInstance?.size.rows }}</span>
          <button type="button" :aria-label="t('widgetLayout.settings.nextSize')" @click="stepPreview(1)">
            ›
          </button>
        </div>
      </section>
      <component :is="customEditor" v-model="draft" class="widget-settings-editor" />
    </div>
    <div v-else-if="instance && fields.length" class="widget-settings-fields">
      <label v-for="([key, descriptor]) in fields" :key="key" class="widget-settings-field">
        <span>{{ fieldLabel(key, descriptor.label) }}</span>
        <small v-if="fieldDescription(descriptor.description)">{{ fieldDescription(descriptor.description) }}</small>
        <NSwitch v-if="descriptor.kind === 'boolean'" v-model:value="draft[key] as boolean" />
        <NSelect v-else-if="descriptor.kind === 'enum'" v-model:value="draft[key] as string" :options="selectOptions(descriptor.values)" />
        <NInputNumber
          v-else-if="descriptor.kind === 'integer' || descriptor.kind === 'number'"
          v-model:value="draft[key] as number"
          :precision="descriptor.kind === 'integer' ? 0 : undefined"
          :min="descriptor.minimum"
          :max="descriptor.maximum"
        />
        <NInput v-else v-model:value="draft[key] as string" :type="descriptor.kind === 'date' ? 'text' : 'text'" :placeholder="descriptor.kind === 'date' ? 'YYYY-MM-DD' : undefined" />
      </label>
    </div>
    <div v-else class="widget-settings-empty">
      {{ t('widgetLayout.settings.empty') }}
    </div>
    <template #footer>
      <div class="widget-settings-actions">
        <NButton @click="visible = false">
          {{ t('widgetLayout.cancel') }}
        </NButton>
        <NButton type="primary" :disabled="!fields.length && !customEditor" @click="save">
          {{ t('widgetLayout.settings.save') }}
        </NButton>
      </div>
    </template>
  </RoundCardModal>
</template>

<style scoped>
.widget-settings-fields { display: grid; gap: 14px; }
.widget-settings-field { display: grid; gap: 6px; }
.widget-settings-field > span { font-size: 13px; font-weight: 700; }
.widget-settings-field > small, .widget-settings-empty { color: var(--pn-color-text-muted, #64748b); font-size: 12px; line-height: 1.6; }
.widget-settings-split { display: grid; grid-template-columns: minmax(0, 400px) minmax(0, 1fr); gap: 24px; align-items: start; }
.widget-settings-preview { position: sticky; top: 0; display: grid; gap: 12px; padding: 14px; border-radius: 18px; background: linear-gradient(160deg, #5b6b8c, #2d3446 60%, #1f2433); }
.widget-settings-preview-title { color: rgb(255 255 255 / 80%); font-size: 13px; font-weight: 700; }
.widget-settings-stage { display: grid; min-height: 210px; place-items: center; }
.widget-settings-frame { display: flex; max-width: 100%; color: white; transition: width .2s ease, height .2s ease; }
.widget-settings-sizes { display: flex; align-items: center; justify-content: center; gap: 10px; color: white; }
.widget-settings-sizes button { display: grid; width: 28px; height: 28px; padding: 0; place-items: center; border: 0; border-radius: 50%; color: inherit; background: rgb(255 255 255 / 16%); cursor: pointer; font-size: 18px; line-height: 1; }
.widget-settings-dots { display: flex; gap: 5px; }
.widget-settings-dots i { width: 6px; height: 6px; border-radius: 50%; background: rgb(255 255 255 / 35%); }
.widget-settings-dots i.is-on { background: white; }
.widget-settings-size { min-width: 28px; color: rgb(255 255 255 / 70%); font-size: 12px; font-variant-numeric: tabular-nums; text-align: center; }
@media (max-width: 760px) { .widget-settings-split { grid-template-columns: minmax(0, 1fr); } .widget-settings-preview { position: static; } }
.widget-settings-actions { display: flex; justify-content: flex-end; gap: 8px; }
:global(.widget-settings-modal.n-card) { display: flex; flex-direction: column; overflow: hidden; }
:global(.widget-settings-modal .n-card__footer) { flex: none; }
</style>
