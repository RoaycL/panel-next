<script setup lang="ts">
// Multicolour weather symbols in the spirit of Apple Weather: yellow sun, white clouds, blue rain.
withDefaults(defineProps<{ kind: string; isDay?: boolean }>(), { isDay: true })

const cloud = 'M13.5 36a7.5 7.5 0 0 1-.9-14.95 11 11 0 0 1 21-2.45A8.7 8.7 0 1 1 35 36Z'
</script>

<template>
  <svg viewBox="0 0 48 48" aria-hidden="true" class="weather-glyph">
    <template v-if="kind === 'clear'">
      <g v-if="isDay">
        <circle cx="24" cy="24" r="9" fill="#FFD60A" />
        <path d="M24 5v5m0 28v5M5 24h5m28 0h5M10.6 10.6l3.5 3.5m19.8 19.8 3.5 3.5M10.6 37.4l3.5-3.5m19.8-19.8 3.5-3.5" stroke="#FFD60A" stroke-width="3" stroke-linecap="round" />
      </g>
      <path v-else d="M33 33.5A15 15 0 0 1 17.5 9 15.5 15.5 0 1 0 39 30a15 15 0 0 1-6 3.5Z" fill="#F2F2F7" />
    </template>
    <template v-else-if="kind === 'unknown'">
      <path d="M20 29V12a4 4 0 0 1 8 0v17a8 8 0 1 1-8 0Z" fill="none" stroke="currentColor" stroke-width="2.6" />
      <path d="M24 20v16" stroke="#FF6B5A" stroke-width="3.2" stroke-linecap="round" />
    </template>
    <template v-else>
      <g v-if="kind === 'partlyCloudy'">
        <g v-if="isDay">
          <circle cx="18" cy="17" r="7" fill="#FFD60A" />
          <path d="M18 4v3M5 17h3M8.8 7.8l2.1 2.1m16.3-2.1-2.1 2.1" stroke="#FFD60A" stroke-width="2.6" stroke-linecap="round" />
        </g>
        <path v-else d="M24 22A10 10 0 0 1 14 7.5 10.5 10.5 0 1 0 27.5 20.5 10 10 0 0 1 24 22Z" fill="#F2F2F7" />
      </g>
      <path v-if="kind === 'cloudy'" :d="cloud" fill="#C7CDD6" transform="translate(-5 -6) scale(.8)" />
      <path
        :d="cloud"
        :fill="kind === 'thunderstorm' ? '#E5E7EC' : 'white'"
        :transform="['rain', 'drizzle', 'snow', 'thunderstorm', 'fog'].includes(kind) ? 'translate(0 -6)' : kind === 'partlyCloudy' ? 'translate(2 2)' : undefined"
      />
      <path v-if="kind === 'rain'" d="m16 35-2.5 6m10.5-6-2.5 6m10.5-6-2.5 6" stroke="#5AC8FA" stroke-width="3" stroke-linecap="round" />
      <path v-if="kind === 'drizzle'" d="m17 35-1 3m8 1-1 3m8-7-1 3" stroke="#5AC8FA" stroke-width="2.6" stroke-linecap="round" />
      <g v-if="kind === 'snow'" fill="white">
        <circle cx="16" cy="37" r="2.2" /><circle cx="24" cy="42" r="2.2" /><circle cx="32" cy="37" r="2.2" />
      </g>
      <path v-if="kind === 'thunderstorm'" d="M25.5 29 19 38.5h6L22 46l9-11h-6l3-6Z" fill="#FFD60A" />
      <path v-if="kind === 'fog'" d="M10 36h28M14 41.5h20" stroke="white" stroke-width="3" stroke-linecap="round" opacity=".85" />
    </template>
  </svg>
</template>

<style scoped>
.weather-glyph { overflow: visible; filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / 14%)); }
</style>
