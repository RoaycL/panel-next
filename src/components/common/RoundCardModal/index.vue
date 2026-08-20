<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { NModal } from 'naive-ui'

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

const bindAttrs = computed<{ class: string; style: string }>(() => ({
  class: (attrs.class as string) || '',
  style: (attrs.style as string) || '',
}))

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
    :style="$parent"
    :title="title"
    :draggable="draggable"
    :resizable="resizable"
    :bordered="false"
    style="border-radius: 1rem;"
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

<style scoped>
/* 移动端全屏优化 */
@media (max-width: 640px) {
  :deep(.n-modal) {
    max-width: 100% !important;
    margin: 0 !important;
    height: 100vh !important;
    border-radius: 0 !important;
  }
}
</style>
