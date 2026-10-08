<script setup lang="ts">
import Clock from '@/components/deskModule/Clock/index.vue'
import ClockDetail from './ClockDetail.vue'

defineProps<{ expanded?: boolean }>()
</script>

<template>
  <ClockDetail v-if="expanded" />
  <Clock v-else display="date" hide-second />
</template>
