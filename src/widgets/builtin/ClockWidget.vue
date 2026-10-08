<script setup lang="ts">
import Clock from '@/components/deskModule/Clock/index.vue'
import ClockDetail from './ClockDetail.vue'

withDefaults(defineProps<{
  hideSecond?: boolean
  showDate?: boolean
  expanded?: boolean
}>(), {
  hideSecond: false,
  showDate: true,
})
</script>

<template>
  <ClockDetail v-if="expanded" />
  <Clock v-else :hide-second="hideSecond" :display="showDate ? 'both' : 'time'" />
</template>
