<script setup lang="ts">
import type { Component } from 'vue'
import { computed, onErrorCaptured, provide, reactive, ref, shallowRef, useAttrs, watch } from 'vue'
import type { WidgetInstance } from './types'
import { widgetRegistry } from './registry'
import { WIDGET_CONTEXT_KEY } from './context'
import { getRuntime } from '@/runtime'
import { t } from '@/locales'
import { useTheme } from '@/themes/context'
import { packageRevision } from '@/packages/manager'
import { NModal } from 'naive-ui'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ instance: WidgetInstance; editMode?: boolean }>()
const attrs = useAttrs()
const component = shallowRef<Component | null>(null)
const renderError = ref<string | null>(null)
const loading = ref(false)
const showDetails = ref(false)
const detailTarget = ref<HTMLElement | null>(null)
const detailFullscreen = ref(false)
const detailTitle = computed(() => t(widgetRegistry.get(props.instance.type)?.meta?.title || props.instance.type))
const retryGeneration = ref(0)
const componentProps = computed(() => ({
  ...(typeof props.instance.config === 'object' && props.instance.config !== null ? props.instance.config : {}),
  ...attrs,
  expanded: showDetails.value,
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
    return showDetails.value ? { columns: 12, rows: 6 } : props.instance.size
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

// Watch the primitives, not a fresh object: a reloaded layout hands us a new
// instance object with the same id/type, and that must not remount the widget.
watch([() => props.instance.type, () => props.instance.id, retryGeneration, packageRevision], async ([type]) => {
  const generation = ++loadGeneration
  component.value = null
  renderError.value = null
  loading.value = true
  const definition = widgetRegistry.get(type)
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
    console.error(`Failed to load widget ${type}.`, error)
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

let pointerStart: { x: number; y: number } | null = null
function rememberPointer(event: PointerEvent) {
  pointerStart = { x: event.clientX, y: event.clientY }
}

function openDetails(event?: MouseEvent) {
  if (props.editMode || showDetails.value || loading.value || renderError.value
    || props.instance.id.startsWith('header.'))
    return
  if (event && pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6)
    return
  if (event && (event.defaultPrevented || (event.target as HTMLElement).closest('a, button, input, textarea, select, [contenteditable], [role="button"]')))
    return
  showDetails.value = true
}
</script>

<template>
  <div
    class="pn-widget-shell widget-shell-frame"
    :data-widget="theme.variants.widget"
    :data-instance-id="instance.id"
    :data-widget-type="instance.type"
    :data-widget-columns="instance.size.columns"
    :data-widget-rows="instance.size.rows"
    :data-widget-placement="instance.id.startsWith('header.') ? 'header' : 'content'"
    @click="openDetails"
    @pointerdown="rememberPointer"
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
    <Teleport v-else-if="component && !instance.hidden" :to="detailTarget || 'body'" :disabled="!showDetails || !detailTarget">
      <div class="widget-render-stage" :class="{ 'is-detail': showDetails }">
        <component :is="component" v-bind="componentProps" />
      </div>
    </Teleport>
    <button v-if="component && !instance.hidden && !editMode && !instance.id.startsWith('header.') && !showDetails" class="widget-expand-button" type="button" :aria-label="t('widgetDetails.expand', { title: detailTitle })" :title="t('widgetDetails.expand', { title: detailTitle })" @click.stop="showDetails = true">
      ⤢
    </button>
  </div>
  <NModal v-model:show="showDetails" preset="card" :title="detailTitle" :to="getRuntime().kind === 'extension' ? '.pn-theme-root' : undefined" class="widget-detail-modal" :class="{ 'is-fullscreen': detailFullscreen }" :style="{ width: detailFullscreen ? 'calc(100vw - 24px)' : 'min(1120px, calc(100vw - 32px))' }" @after-leave="detailFullscreen = false">
    <template #header-extra>
      <button type="button" class="widget-fullscreen-button" :aria-label="t(detailFullscreen ? 'widgetDetails.exitFullscreen' : 'widgetDetails.fullscreen')" @click="detailFullscreen = !detailFullscreen">
        ⤢
      </button>
    </template>
    <div ref="detailTarget" class="widget-detail-body" :class="{ 'is-fullscreen': detailFullscreen }" />
  </NModal>
</template>

<style scoped>
.pn-widget-shell {
  position: relative;
  container-type: inline-size;
  display: flex;
  flex: 1;
  height: 100%;
  min-width: 0;
  min-height: 0;
  color: var(--pn-widget-text-color, inherit);
}
.widget-render-stage { width: 100%; height: 100%; min-width: 0; min-height: 0; }
.widget-render-stage > :deep(*) { box-sizing: border-box; width: 100%; height: 100%; max-width: 100%; overflow: auto; }
.pn-widget-shell > .widget-expand-button { position: absolute; right: 6px; bottom: 5px; z-index: 3; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 7px; color: var(--pn-widget-text-color, inherit); background: var(--pn-widget-background, transparent); cursor: pointer; opacity: 0; font-size: 18px; }
.pn-widget-shell:hover > .widget-expand-button, .widget-expand-button:focus-visible { opacity: 1; }
.widget-expand-button:focus-visible, .widget-fullscreen-button:focus-visible { outline: 2px solid var(--pn-color-accent); outline-offset: 2px; }
.widget-fullscreen-button { width: 28px; height: 28px; border: 0; border-radius: 8px; background: var(--pn-color-surface-hover); color: var(--pn-color-text-primary); cursor: pointer; font-size: 20px; }
.widget-detail-body { container-type: inline-size; height: min(640px, 72dvh); min-height: 0; }
.widget-detail-body.is-fullscreen { height: calc(100dvh - 132px); }
:global(.widget-detail-modal) { border-radius: 24px; background: var(--pn-modal-background, var(--pn-color-surface)); color: var(--pn-color-text-primary); }
@media (max-width: 640px) { .pn-widget-shell > .widget-expand-button { opacity: .7; } .widget-detail-body { height: 72dvh; } }

.pn-widget-shell > :deep(*) {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  overflow: hidden;
}

/* Widgets fit their cell; inner lists may still scroll, but never show a scrollbar track. */
.pn-widget-shell :deep(*) {
  scrollbar-width: none;
}

.pn-widget-shell :deep(*::-webkit-scrollbar) {
  display: none;
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
.pn-widget-shell[data-widget='borderless'] :deep(.countdown-card),
.pn-widget-shell[data-widget='borderless'] :deep(.notes-card),
.pn-widget-shell[data-widget='borderless'] :deep(.calendar-card),
.pn-widget-shell[data-widget='borderless'] :deep(.todo-card),
.pn-widget-shell[data-widget='borderless'] :deep(.workday-card) {
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

<style scoped>
/* Adapt to grid dimensions as well as pixel width. Header widgets retain their hero layout. */
.pn-widget-shell[data-widget-placement='content'] :deep(.clock) {
  display: flex; flex-direction: column; justify-content: center; gap: 4px;
  padding: 6px; border: 1px solid var(--pn-widget-border); border-radius: var(--pn-radius-large, 16px);
  background: var(--pn-widget-background); color: var(--pn-widget-text-color);
}
.pn-widget-shell[data-widget-placement='content'] :deep(.clock-time) { font-size: clamp(12px, 12cqw, 38px); line-height: 1.1; font-weight: 500; font-variant-numeric: tabular-nums; }
.pn-widget-shell[data-widget-placement='content'][data-widget-rows='1'] :deep(.clock-time) { font-size: clamp(12px, 10cqw, 28px); }
.pn-widget-shell[data-widget-placement='content'][data-widget-columns='1'] :deep(.clock) { padding: 4px; gap: 2px; }
.pn-widget-shell[data-widget-placement='content'][data-widget-columns='1'] :deep(.clock-time) { font-size: clamp(9px, 14cqw, 14px); }
.pn-widget-shell[data-widget-placement='content'] :deep(.clock > div) { display: block; font-size: 10px; line-height: 14px; }
.pn-widget-shell[data-widget-placement='content'][data-widget-columns='1'] :deep(.clock-week) { display: block; }
.pn-widget-shell[data-widget-placement='content'] :deep(.search-box) { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.pn-widget-shell[data-widget-placement='content'] :deep(.search-container) { flex: none; min-height: 38px; }
.pn-widget-shell[data-widget-placement='content'] :deep(.search-box input) { min-width: 0; font-size: 12px; }
.pn-widget-shell[data-widget-columns='2'] :deep(.notes-card),
.pn-widget-shell[data-widget-columns='2'] :deep(.todo-card),
.pn-widget-shell[data-widget-columns='2'] :deep(.calendar-card) { padding: 10px; }
.pn-widget-shell[data-widget-columns='2'] :deep(.calendar-header) { gap: 2px; }
.pn-widget-shell[data-widget-columns='2'] :deep(.calendar-header h3) { font-size: 11px; }
.pn-widget-shell[data-widget-columns='2'] :deep(.calendar-actions .today-action) { display: none; }
.pn-widget-shell[data-widget-columns='2'] :deep(.calendar-day) { height: 15px; }
.pn-widget-shell :deep(.notes-header), .pn-widget-shell :deep(.todo-header), .pn-widget-shell :deep(.todo-form) { flex: none; }
.pn-widget-shell :deep(.notes-header h3), .pn-widget-shell :deep(.todo-header h3) { min-width: 0; line-height: 18px; }
.pn-widget-shell :deep(.notes-card textarea), .pn-widget-shell :deep(.todo-list) { min-height: 0; scrollbar-width: thin; }
.pn-widget-shell :deep(.todo-card) { gap: 6px; padding: 10px 12px; }
.pn-widget-shell :deep(.todo-header > div) { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.pn-widget-shell :deep(.todo-form input) { padding: 4px 6px; }
.pn-widget-shell[data-widget-columns='2'] :deep(.notes-header),
.pn-widget-shell[data-widget-columns='2'] :deep(.todo-header) { gap: 4px; }
.pn-widget-shell[data-widget-columns='2'] :deep(.notes-header h3),
.pn-widget-shell[data-widget-columns='2'] :deep(.todo-header h3) { font-size: 12px; }
.pn-widget-shell[data-widget-columns='2'] :deep(.todo-header > div > small) { display: none; }
.pn-widget-shell[data-widget-columns='2'] :deep(.notes-header small),
.pn-widget-shell[data-widget-columns='2'] :deep(.todo-header > small) { font-size: 9px; }
.pn-widget-shell[data-widget-columns='2'] :deep(.workday-card) { padding: 10px; gap: 8px; }
.pn-widget-shell[data-widget-columns='2'] :deep(.workday-main strong) { font-size: clamp(20px, 14cqw, 30px); }
.pn-widget-shell[data-widget-columns='2'] :deep(.countdown-card) { padding: 10px; }
.pn-widget-shell[data-widget-rows='1'] :deep(.countdown-card) { flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; }
.pn-widget-shell[data-widget-rows='1'] :deep(.countdown-header) { flex: 1; overflow: hidden; }
.pn-widget-shell[data-widget-rows='1'] :deep(.countdown-icon),
.pn-widget-shell[data-widget-rows='1'] :deep(.countdown-date) { display: none; }
.pn-widget-shell[data-widget-rows='1'] :deep(.countdown-body) { flex: none; flex-direction: column; flex-wrap: nowrap; gap: 0; }
.pn-widget-shell[data-widget-rows='1'] :deep(.countdown-remaining) { flex-direction: column; align-items: center; gap: 2px; }
.pn-widget-shell[data-widget-rows='1'] :deep(.countdown-remaining strong) { font-size: 24px; }
.pn-widget-shell[data-widget-rows='1'] :deep(.countdown-unit) { font-size: 9px; line-height: 12px; white-space: nowrap; }
.pn-widget-shell[data-widget-rows='1'] :deep(.workday-card) { flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; }
.pn-widget-shell[data-widget-rows='1'] :deep(.workday-card header) { min-width: 0; }
.pn-widget-shell[data-widget-rows='1'] :deep(.workday-icon),
.pn-widget-shell[data-widget-rows='1'] :deep(.workday-main span) { display: none; }
.pn-widget-shell[data-widget-rows='1'] :deep(.workday-main strong) { font-size: clamp(14px, 8cqw, 24px); white-space: nowrap; }
.pn-widget-shell[data-widget-rows='1'] :deep(.workday-main) { flex: none; }
.pn-widget-shell[data-widget-rows='1'] :deep(.trending-card) { padding: 5px 10px; }
.pn-widget-shell[data-widget-rows='1'] :deep(.trending-header) { margin-bottom: 2px; }
.pn-widget-shell[data-widget-rows='1'] :deep(.trending-brand) { width: 18px; height: 18px; }
.pn-widget-shell[data-widget-rows='1'] :deep(.trending-title) { font-size: 11px; }
.pn-widget-shell[data-widget-rows='1'] :deep(.trending-list li) { padding: 1px 0; }
.pn-widget-shell[data-widget-rows='1'] :deep(.trending-item) { font-size: 11px; line-height: 16px; }
/* One row leaves ~64px: failure states lay out in a line so the retry button stays visible. */
.pn-widget-shell[data-widget-rows='1'] :deep(.widget-failure),
.pn-widget-shell[data-widget-rows='1'] :deep(.trending-placeholder.is-failed) { flex-direction: row; flex-wrap: wrap; gap: 4px 8px; padding: 0; }
.pn-widget-shell[data-widget-rows='1'] :deep(.widget-failure .wx-state-icon) { display: none; }
.pn-widget-shell[data-widget-rows='1'] :deep(.widget-failure button),
.pn-widget-shell[data-widget-rows='1'] :deep(.trending-placeholder.is-failed button) { margin-top: 0; padding: 2px 10px; font-size: 11px; }
</style>
