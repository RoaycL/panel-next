<script setup lang="ts">
withDefaults(defineProps<{ kind: string; isDay?: boolean }>(), { isDay: true })
</script>

<template>
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <g v-if="kind === 'clear' && !isDay">
      <path d="M34 32A16 16 0 0 1 17 10a16 16 0 1 0 17 22Z" fill="currentColor" fill-opacity=".12" />
    </g>
    <g v-else-if="kind === 'clear' || kind === 'partlyCloudy'">
      <circle :cx="kind === 'clear' ? 24 : 18" :cy="kind === 'clear' ? 24 : 17" :r="kind === 'clear' ? 9 : 7" fill="currentColor" fill-opacity=".16" />
      <path v-if="kind === 'clear'" d="M24 4v5m0 30v5M4 24h5m30 0h5M10 10l4 4m20 20 4 4M10 38l4-4m20-20 4-4" />
      <path v-else d="M18 3v3M4 17h3M8 7l3 3m17-3-3 3" />
    </g>
    <path v-if="kind !== 'clear' && kind !== 'unknown'" d="M13 32a8 8 0 0 1-1-16 11 11 0 0 1 20 2 7 7 0 1 1 3 14Z" fill="currentColor" fill-opacity=".12" />
    <path v-if="kind === 'rain' || kind === 'drizzle'" d="m15 37-2 5m12-5-2 5m12-5-2 5" />
    <path v-if="kind === 'snow'" d="M16 37v6m-3-3h6m13-3v6m-3-3h6" />
    <path v-if="kind === 'thunderstorm'" d="m25 33-5 7h7l-4 6" />
    <path v-if="kind === 'fog'" d="M11 38h26m-21 5h16" />
    <g v-if="kind === 'unknown'"><path d="M20 29V12a4 4 0 0 1 8 0v17a8 8 0 1 1-8 0Z" /><path d="M24 20v16" /></g>
  </svg>
</template>
