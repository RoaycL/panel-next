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
  const { class: _class, style: _style, ...rest } = attrs
  return rest
})
const modalClass = computed(() => ['round-card-modal', attrs.class])
const modalStyle = computed(() => [
  {
    maxWidth: 'calc(100vw - 24px)',
    maxHeight: 'calc(100vh - 24px)',
    borderRadius: '1.25rem',
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
  border-radius: 20px !important;
  background: rgba(18, 20, 26, 0.84) !important;
  backdrop-filter: blur(28px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(28px) saturate(190%) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08) inset !important;
}

html:not(.dark) .round-card-modal.n-card {
  background: rgba(255, 255, 255, 0.88) !important;
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.8) inset !important;
}

.round-card-modal .n-card-header {
  padding: 14px 20px 12px !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
  background: rgba(255, 255, 255, 0.03) !important;
}

html:not(.dark) .round-card-modal .n-card-header {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06) !important;
  background: rgba(0, 0, 0, 0.02) !important;
}

.round-card-modal .n-card__footer {
  padding: 12px 20px 14px !important;
  border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
}

html:not(.dark) .round-card-modal .n-card__footer {
  border-top: 1px solid rgba(0, 0, 0, 0.06) !important;
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
