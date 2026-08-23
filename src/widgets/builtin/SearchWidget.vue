<script setup lang="ts">
import SearchBox from '@/components/deskModule/SearchBox/index.vue'

withDefaults(defineProps<{
  /** 覆盖主题背景色；缺省时使用 SearchBox 内置的主题变量默认值。 */
  background?: string
  /** 覆盖主题文字色；缺省时使用 SearchBox 内置的主题变量默认值。 */
  textColor?: string
}>(), {
  // 不再写死颜色：未传 props 时完全跟随主题 Widget Token / Search Variant。
  background: undefined,
  textColor: undefined,
})
</script>

<template>
  <SearchBox :background="background" :text-color="textColor" />
</template>
