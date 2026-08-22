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
  attrs.style,
  {
    maxWidth: 'calc(100vw - 24px)',
    maxHeight: 'calc(100vh - 24px)',
    borderRadius: '1rem',
  } satisfies CSSProperties,
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
/* 移动端全屏优化 */
@media (max-width: 640px) {
  .round-card-modal {
    max-width: calc(100vw - 12px) !important;
    max-height: calc(100vh - 12px) !important;
    margin: 6px !important;
    border-radius: 14px !important;
  }
}
</style>
