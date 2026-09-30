<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WeatherResponse } from '@/api/weather'
import { getWeather } from '@/api/weather'
import { useWidgetContext } from '@/widgets/context'

const props = withDefaults(defineProps<{
  city?: string
  units?: 'metric' | 'imperial'
}>(), {
  city: '北京',
  units: 'metric',
})

const { locale, t } = useI18n()
const widgetContext = useWidgetContext()
const weather = ref<WeatherResponse | null>(null)
const loading = ref(false)
const failed = ref(false)
let requestController: AbortController | null = null

function kindFromCode(code?: number) {
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
}

const weatherKind = computed(() => kindFromCode(weather.value?.current.weatherCode))

function iconForKind(kind: string, isDay = true) {
  const icons: Record<string, string> = {
    clear: isDay ? '☀️' : '🌙',
    partlyCloudy: '🌤️',
    cloudy: '☁️',
    fog: '🌫️',
    drizzle: '🌦️',
    rain: '🌧️',
    snow: '🌨️',
    thunderstorm: '⛈️',
    unknown: '🌡️',
  }
  return icons[kind]
}

const weatherIcon = computed(() => iconForKind(weatherKind.value, weather.value?.current.isDay !== false))
const forecast = computed(() => weather.value?.daily?.slice(0, 6) ?? [])
const showForecast = computed(() => (widgetContext?.size.columns ?? 5) >= 4 && (widgetContext?.size.rows ?? 2) >= 2 && forecast.value.length > 0)

function forecastDay(date: string, index: number) {
  if (index === 0)
    return t('weather.today')
  const parsed = new Date(`${date}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(parsed)
}

function forecastDate(date: string) {
  const [, month, day] = date.split('-')
  return `${Number(month)}/${Number(day)}`
}

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
  <section class="weather-card" :class="{ 'is-expanded': showForecast }" :aria-label="t('weather.title')">
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
    <ol v-if="showForecast" class="weather-forecast" :aria-label="t('weather.forecast')">
      <li v-for="(day, index) in forecast" :key="day.date">
        <span class="forecast-day">{{ forecastDay(day.date, index) }}</span>
        <span class="forecast-icon" aria-hidden="true">{{ iconForKind(kindFromCode(day.weatherCode)) }}</span>
        <span class="forecast-temperatures">{{ Math.round(day.temperatureMax) }}°<small>{{ Math.round(day.temperatureMin) }}°</small></span>
        <span class="forecast-date">{{ forecastDate(day.date) }}</span>
      </li>
    </ol>
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
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 9px;
  height: 100%;
  min-width: 190px;
  padding: 10px 34px 15px 13px;
  border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%));
  border-radius: 16px;
  color: var(--pn-widget-text-color, white);
  background: var(--pn-widget-background, rgb(18 25 39 / 42%));
  box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%));
  backdrop-filter: blur(var(--pn-effect-blur, 14px));
  text-shadow: none;
}

.weather-card.is-expanded { justify-content: flex-start; padding: 14px 14px 18px; }
.weather-card.is-expanded .weather-icon { font-size: 34px; }
.weather-forecast { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; min-width: 0; margin: auto 0 0; padding: 10px 0 0; border-top: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%)); list-style: none; }
.weather-forecast li { display: flex; align-items: center; flex-direction: column; gap: 3px; min-width: 0; white-space: nowrap; }
.forecast-day { overflow: hidden; max-width: 100%; color: var(--pn-widget-muted-text, rgb(255 255 255 / 75%)); font-size: 10px; text-overflow: ellipsis; }
.forecast-icon { font-size: 18px; line-height: 1.2; }
.forecast-temperatures { display: flex; gap: 3px; font-size: 11px; font-weight: 700; }
.forecast-temperatures small, .forecast-date { color: var(--pn-widget-muted-text, rgb(255 255 255 / 60%)); font-size: 10px; font-weight: 400; }

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
  color: var(--pn-widget-text-color, rgb(255 255 255 / 78%));
}

.weather-details span:first-child {
  max-width: 76px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.weather-stale {
  color: var(--pn-notification-warning-color, #fcd34d);
}

.weather-refresh {
  position: absolute;
  top: 7px;
  right: 8px;
  padding: 2px 4px;
  color: var(--pn-widget-muted-text, rgb(255 255 255 / 72%));
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
  color: var(--pn-widget-muted-text, rgb(255 255 255 / 55%));
  font-size: 8px;
  line-height: 1;
  text-decoration: none;
}

.weather-source:hover {
  color: var(--pn-widget-text-color, white);
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
