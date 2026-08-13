<script setup lang='ts'>
import { NImage } from 'naive-ui'
import { computed, ref } from 'vue'
import { getRuntime } from '@/runtime'
const props = defineProps<{
  src: string
}>()
const emit = defineEmits<{
  (event: 'click'): void
  (event: 'refresh'): void
}>()

const resolvedSrc = computed(() => getRuntime().resolveUrl(props.src))
const randCode = ref<string>('0')
const captchaSrc = computed(() => `${resolvedSrc.value}${resolvedSrc.value.includes('?') ? '&' : '?'}${randCode.value}`)

function handleClick() {
  randCode.value = String(rand(100, 99999))
  emit('click')
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min)) + min
}

defineExpose({
  // 刷新验证码
  refresh() {
    handleClick()
  },
})
</script>

<template>
  <!-- <div> -->
  <NImage
    :src="captchaSrc"
    :preview-disabled="true"
    @click="handleClick"
  />
  <!-- </div> -->
</template>
