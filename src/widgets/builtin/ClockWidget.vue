<script setup lang="ts">
import Clock from '@/components/deskModule/Clock/index.vue'

withDefaults(defineProps<{
  hideSecond?: boolean
  showDate?: boolean
}>(), {
  hideSecond: false,
  showDate: true,
})
</script>

<template>
  <Clock :hide-second="hideSecond" :display="showDate ? 'both' : 'time'" />
</template>
