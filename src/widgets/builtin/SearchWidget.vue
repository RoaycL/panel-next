<script setup lang="ts">
import SearchBox from '@/components/deskModule/SearchBox/index.vue'

withDefaults(defineProps<{
  background?: string
  textColor?: string
}>(), {
  background: '#2a2a2a6b',
  textColor: 'white',
})
</script>

<template>
  <SearchBox :background="background" :text-color="textColor" />
</template>
