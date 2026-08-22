<script setup lang="ts">
import type { Component } from 'vue'
import { computed, onErrorCaptured, provide, reactive, ref, shallowRef, useAttrs, watch } from 'vue'
import type { WidgetInstance } from './types'
import { widgetRegistry } from './registry'
import { WIDGET_CONTEXT_KEY } from './context'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ instance: WidgetInstance; editMode?: boolean }>()
const attrs = useAttrs()
const component = shallowRef<Component | null>(null)
const renderError = ref<string | null>(null)
const componentProps = computed(() => ({
  ...(typeof props.instance.config === 'object' && props.instance.config !== null ? props.instance.config : {}),
  ...attrs,
}))

// 标准化上下文：任何组件实例内都可通过 useWidgetContext() 读取
const widgetContext = reactive({
  instanceId: props.instance.id,
  type: props.instance.type,
  editMode: props.editMode === true,
})
watch(() => props.editMode, (editMode) => {
  widgetContext.editMode = editMode === true
})
watch(() => [props.instance.id, props.instance.type] as const, ([instanceId, type]) => {
  widgetContext.instanceId = instanceId
  widgetContext.type = type
})
provide(WIDGET_CONTEXT_KEY, widgetContext)

// 错误边界：单个组件的运行时错误不拖垮整个仪表盘
onErrorCaptured((error) => {
  renderError.value = error instanceof Error ? error.message : String(error)
  console.error(`Widget ${props.instance.type} (${props.instance.id}) crashed.`, error)
  return false
})

let loadGeneration = 0

watch(() => ({ type: props.instance.type, id: props.instance.id }), async (next, previous) => {
  const generation = ++loadGeneration
  component.value = null
  if (next.type !== previous?.type)
    renderError.value = null
  const definition = widgetRegistry.get(next.type)
  if (!definition)
    return
  try {
    const loaded = await definition.load()
    if (generation === loadGeneration)
      component.value = loaded
  }
  catch (error) {
    console.error(`Failed to load widget ${next.type}.`, error)
  }
}, { immediate: true })
</script>

<template>
  <div v-if="renderError" class="widget-error-boundary" role="alert">
    <span class="widget-error-icon" aria-hidden="true">⚠️</span>
    <span class="widget-error-text">组件加载异常</span>
    <code class="widget-error-detail">{{ instance.type }}</code>
  </div>
  <component :is="component" v-else-if="component && !instance.hidden" v-bind="componentProps" />
</template>

<style scoped>
.widget-error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 56px;
  padding: 12px;
  border: 1px dashed rgb(255 255 255 / 25%);
  border-radius: 16px;
  color: rgb(255 255 255 / 75%);
  font-size: 12px;
}

.widget-error-detail {
  padding: 1px 6px;
  border-radius: 6px;
  background: rgb(255 255 255 / 10%);
  font-size: 11px;
}
</style>
