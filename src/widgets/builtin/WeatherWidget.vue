<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WeatherResponse } from '@/api/weather'
import { getWeather } from '@/api/weather'

const props = withDefaults(defineProps<{
  city?: string
  units?: 'metric' | 'imperial'
}>(), {
  city: '北京',
  units: 'metric',
})

const { locale, t } = useI18n()
const weather = ref<WeatherResponse | null>(null)
const loading = ref(false)
const failed = ref(false)
let requestController: AbortController | null = null

const weatherKind = computed(() => {
  const code = weather.value?.current.weatherCode
  if (code === undefined)
    return 'unknown'
  if (code === 0)
    return 'clear'
  if ([1, 2].includes(code))
    return 'partlyCloudy'
  if (code === 3)
    return 'cloudy'
  if ([45, 48].includes(code))
    return 'fog'
  if ([51, 53, 55, 56, 57].includes(code))
    return 'drizzle'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return 'rain'
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return 'snow'
  if ([95, 96, 99].includes(code))
    return 'thunderstorm'
  return 'unknown'
})

const weatherIcon = computed(() => {
  const icons: Record<string, string> = {
    clear: weather.value?.current.isDay === false ? '🌙' : '☀️',
    partlyCloudy: '🌤️',
    cloudy: '☁️',
    fog: '🌫️',
    drizzle: '🌦️',
    rain: '🌧️',
    snow: '🌨️',
    thunderstorm: '⛈️',
    unknown: '🌡️',
  }
  return icons[weatherKind.value]
})

const condition = computed(() => t(`weather.conditions.${weatherKind.value}`))
const locationLabel = computed(() => {
  if (!weather.value)
    return props.city
  const { name, admin1, country } = weather.value.location
  return [name, admin1 && admin1 !== name ? admin1 : '', country].filter(Boolean).join(' · ')
})

async function refresh() {
  requestController?.abort()
  requestController = new AbortController()
  loading.value = true
  failed.value = false
  try {
    const response = await getWeather(props.city, props.units, requestController.signal)
    if (response.code === 0)
      weather.value = response.data
    else
      failed.value = true
  }
  catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError'))
      failed.value = true
  }
  finally {
    loading.value = false
  }
}

watch([() => props.city, () => props.units, locale], refresh, { immediate: true })
const refreshTimer = window.setInterval(refresh, 10 * 60 * 1000)

onUnmounted(() => {
  requestController?.abort()
  window.clearInterval(refreshTimer)
})
</script>

<template>
  <section class="weather-card" :aria-label="t('weather.title')">
    <div v-if="weather" class="weather-current">
      <span class="weather-icon" aria-hidden="true">{{ weatherIcon }}</span>
      <div class="weather-reading">
        <strong>{{ Math.round(weather.current.temperature) }}{{ weather.current.temperatureUnit }}</strong>
        <span>{{ condition }}</span>
      </div>
      <div class="weather-details">
        <span :title="locationLabel">{{ weather.location.name }}</span>
        <span>{{ t('weather.humidity', { value: weather.current.relativeHumidity }) }}</span>
        <span v-if="weather.stale" class="weather-stale">{{ t('weather.stale') }}</span>
      </div>
    </div>
    <div v-else class="weather-placeholder">
      <span aria-hidden="true">{{ failed ? '⚠️' : '🌤️' }}</span>
      <span>{{ failed ? t('weather.unavailable') : t('weather.loading') }}</span>
    </div>
    <button class="weather-refresh" type="button" :disabled="loading" :title="t('weather.refresh')" @click="refresh">
      <span aria-hidden="true">↻</span>
      <span class="sr-only">{{ t('weather.refresh') }}</span>
    </button>
    <a class="weather-source" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>
  </section>
</template>

<style scoped>
.weather-card {
  position: relative;
  min-width: 190px;
  padding: 10px 34px 15px 13px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 16px;
  color: white;
  background: rgb(18 25 39 / 42%);
  box-shadow: 0 10px 30px rgb(0 0 0 / 14%);
  backdrop-filter: blur(14px);
  text-shadow: none;
}

.weather-current,
.weather-placeholder {
  display: flex;
  align-items: center;
  gap: 9px;
}

.weather-icon,
.weather-placeholder > :first-child {
  font-size: 28px;
  line-height: 1;
}

.weather-reading,
.weather-details {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.weather-reading strong {
  font-size: 19px;
  line-height: 1.15;
}

.weather-reading span,
.weather-details span,
.weather-placeholder {
  font-size: 11px;
  white-space: nowrap;
}

.weather-details {
  margin-left: 3px;
  color: rgb(255 255 255 / 78%);
}

.weather-details span:first-child {
  max-width: 76px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.weather-stale {
  color: #fcd34d;
}

.weather-refresh {
  position: absolute;
  top: 7px;
  right: 8px;
  padding: 2px 4px;
  color: rgb(255 255 255 / 72%);
  border: 0;
  background: transparent;
  cursor: pointer;
}

.weather-refresh:disabled {
  cursor: wait;
  opacity: .45;
}

.weather-source {
  position: absolute;
  right: 8px;
  bottom: 3px;
  color: rgb(255 255 255 / 55%);
  font-size: 8px;
  line-height: 1;
  text-decoration: none;
}

.weather-source:hover {
  color: white;
  text-decoration: underline;
}

@media (max-width: 640px) {
  .weather-card {
    min-width: 0;
  }

  .weather-details {
    display: none;
  }
}
</style>
