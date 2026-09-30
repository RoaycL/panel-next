<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NInputNumber, NSelect, NSwitch, useMessage } from 'naive-ui'
import RoundCardModal from '@/components/common/RoundCardModal/index.vue'
import type { WidgetInstance } from './types'
import { widgetRegistry } from './registry'
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

watch(() => [props.show, props.instance] as const, ([show, instance]) => {
  if (show && instance)
    draft.value = JSON.parse(JSON.stringify(instance.config ?? {}))
}, { immediate: true, deep: true })

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
  <RoundCardModal v-model:show="visible" class="widget-settings-modal" :title="t('widgetLayout.settings.title')" style="width: min(520px, calc(100vw - 24px));" content-style="min-height: 0; overflow-y: auto;">
    <div v-if="instance && fields.length" class="widget-settings-fields">
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
        <NButton type="primary" :disabled="!fields.length" @click="save">
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
.widget-settings-actions { display: flex; justify-content: flex-end; gap: 8px; }
:global(.widget-settings-modal.n-card) { display: flex; flex-direction: column; overflow: hidden; }
:global(.widget-settings-modal .n-card__footer) { flex: none; }
</style>
