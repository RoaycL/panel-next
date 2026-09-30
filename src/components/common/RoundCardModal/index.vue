<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import type { CSSProperties } from 'vue'
import { NModal } from 'naive-ui'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  title?: string
  show: boolean
  size?: 'medium' | 'small' | 'large' | 'huge' | undefined
  draggable?: boolean
  resizable?: boolean
}>(), {
  draggable: true,
  resizable: true,
})

const emit = defineEmits<{
  (e: 'update:show', show: boolean): void
}>()

const attrs = useAttrs()

const bindAttrs = computed(() => {
  const { class: _class, style: _style, to: _to, ...rest } = attrs
  return rest
})
const modalTarget = computed(() => (attrs.to as string | HTMLElement | undefined)
  ?? '.pn-theme-root')
const modalClass = computed(() => ['round-card-modal', attrs.class])
const modalStyle = computed(() => [
  {
    maxWidth: 'calc(100vw - 24px)',
    maxHeight: 'calc(100vh - 24px)',
    borderRadius: 'var(--pn-radius-large, 18px)',
  } satisfies CSSProperties,
  attrs.style as CSSProperties,
])

const showModal = computed({
  get: () => props.show,
  set: (show: boolean) => {
    emit('update:show', show)
  },
})
</script>

<template>
  <NModal
    v-model:show="showModal"
    preset="card"
    :size="size"
    v-bind="bindAttrs"
    :class="modalClass"
    :to="modalTarget"
    :style="modalStyle"
    :title="title"
    :draggable="draggable"
    :resizable="resizable"
    :bordered="false"
  >
    <template #cover>
      <slot name="cover" />
    </template>
    <template #header>
      <slot name="header" />
    </template>
    <template #header-extra>
      <slot name="header-extra" />
    </template>
    <template #footer>
      <slot name="footer" />
    </template>
    <template #action>
      <slot name="action" />
    </template>
    <slot />
  </NModal>
</template>

<style>
/* Global Frosted Glass Modal Theme for RoundCardModal */
.round-card-modal.n-card {
  border-radius: var(--pn-radius-large, 20px) !important;
  color: var(--pn-modal-content-text-color, var(--pn-color-text-secondary, inherit)) !important;
  background: var(--pn-modal-background, rgba(18, 20, 26, 0.96)) !important;
  border: 1px solid var(--pn-modal-border, var(--pn-color-border, rgba(255, 255, 255, 0.12))) !important;
  box-shadow: var(--pn-effect-shadow-high, 0 25px 60px -15px rgba(0, 0, 0, 0.65)) !important;
}

.round-card-modal .n-card-header {
  padding: 14px 20px 12px !important;
  color: var(--pn-modal-title-text-color, var(--pn-color-text-primary, inherit)) !important;
  border-bottom: 1px solid var(--pn-modal-border, var(--pn-color-border, rgba(255, 255, 255, 0.08))) !important;
  background: var(--pn-color-surface-hover, transparent) !important;
}

.round-card-modal .n-card__footer {
  padding: 12px 20px 14px !important;
  border-top: 1px solid var(--pn-modal-border, var(--pn-color-border, rgba(255, 255, 255, 0.08))) !important;
}

/* 移动端全屏优化 */
@media (max-width: 640px) {
  .round-card-modal.n-card {
    max-width: calc(100vw - 12px) !important;
    max-height: calc(100vh - 12px) !important;
    margin: 6px !important;
    border-radius: 16px !important;
  }
}
</style>
