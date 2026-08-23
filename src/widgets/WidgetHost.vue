<script setup lang="ts">
import type { Component } from 'vue'
import { computed, onErrorCaptured, provide, reactive, ref, shallowRef, useAttrs, watch } from 'vue'
import type { WidgetInstance } from './types'
import { widgetRegistry } from './registry'
import { WIDGET_CONTEXT_KEY } from './context'
import { getRuntime } from '@/runtime'
import { t } from '@/locales'
import { useTheme } from '@/themes/context'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ instance: WidgetInstance; editMode?: boolean }>()
const attrs = useAttrs()
const component = shallowRef<Component | null>(null)
const renderError = ref<string | null>(null)
const loading = ref(false)
const retryGeneration = ref(0)
const componentProps = computed(() => ({
  ...(typeof props.instance.config === 'object' && props.instance.config !== null ? props.instance.config : {}),
  ...attrs,
}))

// 主题切片：无 ThemeProvider（独立预览）时自动回退默认主题。
const theme = useTheme()

// 标准化上下文：任何组件实例内都可通过 useWidgetContext() 读取
const widgetContext = reactive({
  instanceId: props.instance.id,
  type: props.instance.type,
  editMode: props.editMode === true,
  capabilities: widgetRegistry.get(props.instance.type)?.capabilities ?? [],
  surface: getRuntime().kind,
  get themeId() {
    return theme.themeId
  },
  get resolvedMode() {
    return theme.resolvedMode
  },
  get themeTokens() {
    return theme.tokens.widget
  },
  get size() {
    return props.instance.size
  },
})
watch(() => props.editMode, (editMode) => {
  widgetContext.editMode = editMode === true
})
watch(() => [props.instance.id, props.instance.type] as const, ([instanceId, type]) => {
  widgetContext.instanceId = instanceId
  widgetContext.type = type
  widgetContext.capabilities = widgetRegistry.get(type)?.capabilities ?? []
})
provide(WIDGET_CONTEXT_KEY, widgetContext)

// 错误边界：单个组件的运行时错误不拖垮整个仪表盘
onErrorCaptured((error) => {
  renderError.value = error instanceof Error ? error.message : String(error)
  console.error(`Widget ${props.instance.type} (${props.instance.id}) crashed.`, error)
  return false
})

let loadGeneration = 0

watch(() => ({ type: props.instance.type, id: props.instance.id, retry: retryGeneration.value }), async (next) => {
  const generation = ++loadGeneration
  component.value = null
  renderError.value = null
  loading.value = true
  const definition = widgetRegistry.get(next.type)
  if (!definition) {
    renderError.value = t('widgetLayout.host.unsupported')
    loading.value = false
    return
  }
  try {
    const loaded = await definition.load()
    if (generation === loadGeneration) {
      component.value = loaded
      loading.value = false
    }
  }
  catch (error) {
    console.error(`Failed to load widget ${next.type}.`, error)
    if (generation === loadGeneration) {
      renderError.value = error instanceof Error ? error.message : t('widgetLayout.host.loadFailed')
      loading.value = false
    }
  }
}, { immediate: true })

watch(() => props.instance.config, () => {
  renderError.value = null
}, { deep: true })

function retryLoad() {
  retryGeneration.value++
}
</script>

<template>
  <div
    class="pn-widget-shell widget-shell-frame"
    :data-widget="theme.variants.widget"
    :data-instance-id="instance.id"
  >
    <div v-if="renderError" class="widget-error-boundary" role="alert">
      <span class="widget-error-icon" aria-hidden="true">⚠️</span>
      <span class="widget-error-text">{{ t('widgetLayout.host.error') }}</span>
      <code class="widget-error-detail">{{ instance.type }}</code>
      <button type="button" class="widget-error-retry" @click="retryLoad">
        {{ t('widgetLayout.host.retry') }}
      </button>
    </div>
    <div v-else-if="loading" class="widget-loading" role="status">
      {{ t('widgetLayout.host.loading') }}
    </div>
    <component :is="component" v-else-if="component && !instance.hidden" v-bind="componentProps" />
  </div>
</template>

<style scoped>
.pn-widget-shell {
  container-type: inline-size;
  display: flex;
  flex: 1;
  height: 100%;
  min-width: 0;
  min-height: 0;
  color: var(--pn-widget-text-color, inherit);
}

.pn-widget-shell > :deep(*) {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
}

/* Widget Variant（§13）：glass 默认；solid 用表面色；borderless 去壳。 */
.pn-widget-shell[data-widget='solid'] {
  --pn-widget-background: var(--pn-color-surface);
  --pn-widget-border: var(--pn-color-border);
}

.pn-widget-shell[data-widget='borderless'] {
  --pn-widget-background: transparent;
  --pn-widget-border: transparent;
  --pn-widget-shadow: none;
}

.pn-widget-shell[data-widget='borderless'] :deep(.trending-card),
.pn-widget-shell[data-widget='borderless'] :deep(.weather-card),
.pn-widget-shell[data-widget='borderless'] :deep(.countdown-card) {
  backdrop-filter: none;
  box-shadow: none;
}

.widget-error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--pn-spacing-compact, 8px);
  width: 100%;
  min-height: 56px;
  padding: var(--pn-spacing-normal, 12px);
  border: 1px dashed var(--pn-widget-error-border, rgb(255 255 255 / 25%));
  border-radius: var(--pn-radius-large, 16px);
  color: var(--pn-widget-error-color, rgb(255 255 255 / 75%));
  font-size: 12px;
}

.widget-error-detail {
  padding: 1px 6px;
  border-radius: var(--pn-radius-small, 6px);
  background: var(--pn-widget-retry-background, rgb(255 255 255 / 10%));
  font-size: 11px;
}

.widget-error-retry {
  padding: 3px 8px;
  border: 1px solid var(--pn-widget-retry-border, rgb(255 255 255 / 22%));
  border-radius: var(--pn-radius-small, 7px);
  color: inherit;
  background: var(--pn-widget-retry-background, rgb(255 255 255 / 8%));
  cursor: pointer;
  transition: background var(--pn-effect-duration-fast, 120ms) ease;
}

.widget-loading {
  display: grid;
  width: 100%;
  min-height: 56px;
  place-items: center;
  color: var(--pn-widget-loading-color, rgb(255 255 255 / 58%));
  font-size: 12px;
}
</style>
