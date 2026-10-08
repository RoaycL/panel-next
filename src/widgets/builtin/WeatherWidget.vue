<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WeatherResponse } from '@/api/weather'
import { getWeather } from '@/api/weather'
import { useWidgetContext } from '@/widgets/context'
import WeatherGlyph from './WeatherGlyph.vue'

const props = withDefaults(defineProps<{
  city?: string
  units?: 'metric' | 'imperial'
  expanded?: boolean
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
const isDay = computed(() => weather.value?.current.isDay ?? true)

// The sky groups conditions the way Apple Weather paints its backgrounds.
const sky = computed(() => {
  const kind = weatherKind.value
  const group = ({ clear: 'clear', partlyCloudy: 'partly', cloudy: 'cloudy', fog: 'fog', drizzle: 'rain', rain: 'rain', snow: 'snow', thunderstorm: 'storm' } as Record<string, string>)[kind] ?? 'partly'
  return { group, className: `sky-${group}-${isDay.value ? 'day' : 'night'}` }
})

const layout = computed(() => {
  if (props.expanded)
    return 'detail'
  const size = widgetContext?.size ?? { columns: 4, rows: 2 }
  if (widgetContext?.instanceId.startsWith('header.') || size.rows < 2)
    return 'compact'
  return size.columns <= 2 ? 'small' : 'medium'
})

// Deterministic pseudo-random particles so the sky does not reshuffle on every render.
const particleCount = computed(() => {
  if (!['rain', 'storm', 'snow'].includes(sky.value.group))
    return 0
  const base = sky.value.group === 'snow' ? 26 : 34
  return layout.value === 'detail' ? base * 2 : layout.value === 'compact' ? Math.round(base / 2) : base
})
const particles = computed(() => Array.from({ length: particleCount.value }, (_, index) => {
  const duration = sky.value.group === 'snow' ? 6 + (index * 7 % 50) / 10 : 0.6 + (index * 13 % 7) / 10
  return {
    left: `${(index * 37 + 11) % 100}%`,
    animationDuration: `${duration}s`,
    animationDelay: `-${((index * 53) % 100) / 100 * duration}s`,
    opacity: 0.35 + (index * 17 % 6) / 10,
    scale: 0.6 + (index * 29 % 5) / 10,
  }
}))

function round(value: number) {
  return Math.round(value)
}

const today = computed(() => weather.value?.daily?.[0])
const highLow = computed(() => today.value
  ? t('weather.highLow', { high: round(today.value.temperatureMax), low: round(today.value.temperatureMin) })
  : '')
const condition = computed(() => t(`weather.conditions.${weatherKind.value}`))
const locationLabel = computed(() => {
  if (!weather.value)
    return props.city
  const { name, admin1, country } = weather.value.location
  return [name, admin1 && admin1 !== name ? admin1 : '', country].filter(Boolean).join(' · ')
})

function parseLocal(value: string) {
  // Open-Meteo returns wall-clock times in the location's zone; formatting them without a zone keeps that clock.
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function hourLabel(time: string) {
  const parsed = parseLocal(time)
  return parsed ? new Intl.DateTimeFormat(locale.value, { hour: 'numeric' }).format(parsed) : time.slice(11, 13)
}

function clockLabel(time?: string) {
  return time && time.length >= 16 ? time.slice(11, 16) : ''
}

function dayLabel(date: string, index: number) {
  if (index === 0)
    return t('weather.today')
  const parsed = parseLocal(date)
  return parsed ? new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(parsed) : date
}

const hours = computed(() => {
  const list = weather.value?.hourly ?? []
  return list.map((hour, index) => ({
    key: hour.time,
    label: index === 0 ? t('weather.now') : hourLabel(hour.time),
    kind: kindFromCode(hour.weatherCode),
    isDay: hour.isDay,
    chance: hour.precipitationProbability,
    temperature: index === 0 && weather.value ? round(weather.value.current.temperature) : round(hour.temperature),
  }))
})

// Grid sizes show a short strip: upcoming hours when the server sends them, otherwise the next days.
const strip = computed(() => {
  const count = (widgetContext?.size.columns ?? 4) >= 4 ? 6 : 5
  if (hours.value.length > 0)
    return hours.value.slice(0, count)
  return (weather.value?.daily ?? []).slice(0, count).map((day, index) => ({
    key: day.date,
    label: dayLabel(day.date, index),
    kind: kindFromCode(day.weatherCode),
    isDay: true,
    chance: day.precipitationProbability ?? 0,
    temperature: round(day.temperatureMax),
  }))
})

function toCelsius(value: number) {
  return props.units === 'imperial' ? (value - 32) * 5 / 9 : value
}

// Same palette Apple uses on its range bars: blue when cold, green when mild, orange to red when hot.
function temperatureColor(value: number) {
  const celsius = toCelsius(value)
  const stops: Array<[number, number[]]> = [[-10, [94, 92, 230]], [0, [90, 200, 250]], [10, [99, 214, 196]], [18, [168, 224, 95]], [24, [255, 214, 10]], [30, [255, 159, 10]], [36, [255, 69, 58]]]
  if (celsius <= stops[0][0])
    return `rgb(${stops[0][1].join(' ')})`
  for (let index = 1; index < stops.length; index++) {
    const [limit, color] = stops[index]
    if (celsius <= limit) {
      const [previousLimit, previous] = stops[index - 1]
      const ratio = (celsius - previousLimit) / (limit - previousLimit)
      return `rgb(${previous.map((channel, channelIndex) => Math.round(channel + (color[channelIndex] - channel) * ratio)).join(' ')})`
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(' ')})`
}

const days = computed(() => {
  const list = weather.value?.daily ?? []
  if (!list.length)
    return []
  const lowest = Math.min(...list.map(day => day.temperatureMin))
  const highest = Math.max(...list.map(day => day.temperatureMax))
  const span = Math.max(highest - lowest, 1)
  const current = weather.value?.current.temperature
  return list.map((day, index) => ({
    key: day.date,
    label: dayLabel(day.date, index),
    kind: kindFromCode(day.weatherCode),
    chance: day.precipitationProbability ?? 0,
    low: round(day.temperatureMin),
    high: round(day.temperatureMax),
    barStyle: {
      left: `${(day.temperatureMin - lowest) / span * 100}%`,
      width: `${Math.max((day.temperatureMax - day.temperatureMin) / span * 100, 4)}%`,
      backgroundImage: `linear-gradient(90deg, ${temperatureColor(day.temperatureMin)}, ${temperatureColor(day.temperatureMax)})`,
    },
    currentDot: index === 0 && current !== undefined
      ? { left: `${Math.min(Math.max((current - lowest) / span, 0), 1) * 100}%` }
      : null,
  }))
})

const uvLevel = computed(() => {
  const value = weather.value?.current.uvIndex ?? 0
  if (value < 3)
    return 'low'
  if (value < 6)
    return 'moderate'
  if (value < 8)
    return 'high'
  if (value < 11)
    return 'veryHigh'
  return 'extreme'
})

const windDirection = computed(() => {
  const degrees = weather.value?.current.windDirection ?? 0
  const names = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
  return t(`weather.directions.${names[Math.round(((degrees % 360) + 360) % 360 / 45) % 8]}`)
})

const feelsNote = computed(() => {
  if (!weather.value)
    return ''
  const difference = weather.value.current.apparentTemperature - weather.value.current.temperature
  if (Math.abs(difference) < 2)
    return t('weather.feelsSimilar')
  return t(difference < 0 ? 'weather.feelsCooler' : 'weather.feelsWarmer')
})

const visibility = computed(() => {
  const current = weather.value?.current
  if (current?.visibility === undefined)
    return ''
  const imperial = current.visibilityUnit === 'ft'
  const value = imperial ? current.visibility / 5280 : current.visibility / 1000
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${imperial ? 'mi' : 'km'}`
})

// After sunset (or before sunrise) the tile leads with the next sunrise, like Apple Weather.
const sunTile = computed(() => {
  const current = weather.value?.current.time ?? ''
  const [first, second] = weather.value?.daily ?? []
  if (!first?.sunrise || !first.sunset)
    return null
  if (current < first.sunrise)
    return { title: t('weather.sunrise'), value: clockLabel(first.sunrise), note: `${t('weather.sunset')} ${clockLabel(first.sunset)}`, rising: true }
  if (current < first.sunset)
    return { title: t('weather.sunset'), value: clockLabel(first.sunset), note: `${t('weather.sunrise')} ${clockLabel(second?.sunrise ?? first.sunrise)}`, rising: false }
  return { title: t('weather.sunrise'), value: clockLabel(second?.sunrise ?? first.sunrise), note: `${t('weather.sunset')} ${clockLabel(second?.sunset ?? first.sunset)}`, rising: true }
})

const updatedLabel = computed(() => weather.value ? t('weather.updatedShort', { time: clockLabel(weather.value.current.time) }) : '')

function scrollHours(event: WheelEvent) {
  const target = event.currentTarget as HTMLElement
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || target.scrollWidth <= target.clientWidth)
    return
  target.scrollLeft += event.deltaY
  event.preventDefault()
}

async function refresh() {
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  loading.value = true
  failed.value = false
  try {
    const response = await getWeather(props.city, props.units, controller.signal)
    if (requestController !== controller)
      return
    if (response.code === 0)
      weather.value = response.data
    else
      failed.value = true
  }
  catch (error) {
    if (requestController === controller && !(error instanceof DOMException && error.name === 'AbortError'))
      failed.value = true
  }
  finally {
    if (requestController === controller)
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
  <section class="weather-card" :class="[sky.className, `is-${layout}`]" :aria-label="t('weather.title')">
    <div class="weather-sky" aria-hidden="true">
      <span v-if="['clear', 'partly'].includes(sky.group)" class="sky-glow" />
      <span v-if="!isDay && ['clear', 'partly'].includes(sky.group)" class="sky-stars" />
      <template v-if="sky.group !== 'clear'">
        <span class="sky-cloud cloud-a" />
        <span class="sky-cloud cloud-b" />
        <span v-if="sky.group !== 'partly'" class="sky-cloud cloud-c" />
      </template>
      <template v-if="sky.group === 'fog'">
        <span class="sky-fog fog-a" />
        <span class="sky-fog fog-b" />
      </template>
      <span
        v-for="(particle, index) in particles"
        :key="index"
        :class="sky.group === 'snow' ? 'sky-flake' : 'sky-drop'"
        :style="{ left: particle.left, animationDuration: particle.animationDuration, animationDelay: particle.animationDelay, opacity: particle.opacity, '--particle-scale': particle.scale }"
      />
      <span v-if="sky.group === 'storm'" class="sky-flash" />
    </div>

    <template v-if="weather">
      <!-- One row or the header: a single line. -->
      <div v-if="layout === 'compact'" class="wx-compact">
        <WeatherGlyph class="wx-compact-icon" :kind="weatherKind" :is-day="isDay" />
        <strong class="wx-compact-temp">{{ round(weather.current.temperature) }}°</strong>
        <div class="wx-compact-text">
          <span class="wx-city" :title="locationLabel">{{ weather.location.name }}</span>
          <span>{{ condition }}</span>
          <span v-if="highLow" class="wx-compact-range-inline">{{ highLow }}</span>
        </div>
        <span v-if="highLow" class="wx-compact-range">{{ highLow }}</span>
      </div>

      <!-- 2×2: Apple's small widget. -->
      <div v-else-if="layout === 'small'" class="wx-small">
        <span class="wx-city" :title="locationLabel">{{ weather.location.name }}</span>
        <strong class="wx-temp">{{ round(weather.current.temperature) }}°</strong>
        <div class="wx-small-foot">
          <WeatherGlyph class="wx-small-icon" :kind="weatherKind" :is-day="isDay" />
          <span>{{ condition }}</span>
          <span v-if="highLow">{{ highLow }}</span>
        </div>
      </div>

      <!-- 3–4 columns: Apple's medium widget with an hourly strip. -->
      <div v-else-if="layout === 'medium'" class="wx-medium">
        <div class="wx-medium-top">
          <div class="wx-headline">
            <span class="wx-city" :title="locationLabel">{{ weather.location.name }}</span>
            <strong class="wx-temp">{{ round(weather.current.temperature) }}°</strong>
          </div>
          <div class="wx-summary">
            <WeatherGlyph class="wx-summary-icon" :kind="weatherKind" :is-day="isDay" />
            <span>{{ condition }}</span>
            <span v-if="highLow">{{ highLow }}</span>
          </div>
        </div>
        <ol class="wx-strip" :aria-label="t(hours.length ? 'weather.hourly' : 'weather.forecast')">
          <li v-for="item in strip" :key="item.key">
            <span class="wx-strip-label">{{ item.label }}</span>
            <WeatherGlyph class="wx-strip-icon" :kind="item.kind" :is-day="item.isDay" />
            <span class="wx-strip-temp">{{ item.temperature }}°</span>
          </li>
        </ol>
      </div>

      <!-- Enlarged: the Apple Weather app. -->
      <div v-else class="wx-detail">
        <header class="wx-hero">
          <span class="wx-hero-city" :title="locationLabel">{{ weather.location.name }}</span>
          <strong class="wx-hero-temp">{{ round(weather.current.temperature) }}°</strong>
          <span class="wx-hero-condition">{{ condition }}</span>
          <span v-if="highLow" class="wx-hero-range">{{ highLow }}</span>
          <span class="wx-hero-meta">
            {{ locationLabel }}
            <span v-if="weather.stale" class="weather-stale">· {{ t('weather.stale') }}</span>
          </span>
        </header>

        <section v-if="hours.length" class="wx-panel wx-hourly">
          <h3 class="wx-panel-title">
            {{ t('weather.hourly') }}
          </h3>
          <ol class="wx-hours" @wheel="scrollHours">
            <li v-for="hour in hours" :key="hour.key">
              <span class="wx-hour-label">{{ hour.label }}</span>
              <WeatherGlyph class="wx-hour-icon" :kind="hour.kind" :is-day="hour.isDay" />
              <span class="wx-chance" :class="{ 'is-hidden': hour.chance < 20 }">{{ hour.chance }}%</span>
              <span class="wx-hour-temp">{{ hour.temperature }}°</span>
            </li>
          </ol>
        </section>

        <section v-if="days.length" class="wx-panel wx-daily">
          <h3 class="wx-panel-title">
            {{ t('weather.daily', { count: days.length }) }}
          </h3>
          <ol class="wx-days">
            <li v-for="day in days" :key="day.key">
              <span class="wx-day-label">{{ day.label }}</span>
              <span class="wx-day-icon">
                <WeatherGlyph :kind="day.kind" />
                <span v-if="day.chance >= 20" class="wx-chance">{{ day.chance }}%</span>
              </span>
              <span class="wx-day-low">{{ day.low }}°</span>
              <span class="wx-range"><span class="wx-range-fill" :style="day.barStyle" /><span v-if="day.currentDot" class="wx-range-dot" :style="day.currentDot" /></span>
              <span class="wx-day-high">{{ day.high }}°</span>
            </li>
          </ol>
        </section>

        <div class="wx-tiles">
          <section class="wx-panel wx-tile">
            <h3 class="wx-panel-title">
              {{ t('weather.feelsLike') }}
            </h3>
            <strong class="wx-tile-value">{{ round(weather.current.apparentTemperature) }}°</strong>
            <span class="wx-tile-note">{{ feelsNote }}</span>
          </section>
          <section class="wx-panel wx-tile">
            <h3 class="wx-panel-title">
              {{ t('weather.humidityTitle') }}
            </h3>
            <strong class="wx-tile-value">{{ weather.current.relativeHumidity }}%</strong>
            <span v-if="weather.current.dewPoint !== undefined" class="wx-tile-note">{{ t('weather.dewPoint', { value: round(weather.current.dewPoint) }) }}</span>
          </section>
          <section class="wx-panel wx-tile wx-wind">
            <h3 class="wx-panel-title">
              {{ t('weather.wind') }}
            </h3>
            <div class="wx-wind-body">
              <div>
                <strong class="wx-tile-value">{{ round(weather.current.windSpeed) }}<small>{{ weather.current.windSpeedUnit }}</small></strong>
                <span class="wx-tile-note">{{ windDirection }}</span>
              </div>
              <svg class="wx-compass" viewBox="0 0 64 64" aria-hidden="true">
                <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="5" stroke-dasharray="1.5 4.2" />
                <g :style="{ transform: `rotate(${(weather.current.windDirection ?? 0) + 180}deg)`, transformOrigin: '32px 32px' }">
                  <path d="M32 10v40" stroke="white" stroke-width="2.6" stroke-linecap="round" />
                  <path d="m25 17 7-9 7 9Z" fill="white" />
                  <circle cx="32" cy="50" r="3.4" fill="none" stroke="white" stroke-width="2.4" />
                </g>
              </svg>
            </div>
          </section>
          <section v-if="weather.current.uvIndex !== undefined" class="wx-panel wx-tile">
            <h3 class="wx-panel-title">
              {{ t('weather.uv') }}
            </h3>
            <strong class="wx-tile-value">{{ round(weather.current.uvIndex) }}<small>{{ t(`weather.uvLevels.${uvLevel}`) }}</small></strong>
            <span class="wx-uv-bar"><span class="wx-uv-dot" :style="{ left: `${Math.min(weather.current.uvIndex / 11, 1) * 100}%` }" /></span>
          </section>
          <section v-if="sunTile" class="wx-panel wx-tile">
            <h3 class="wx-panel-title">
              {{ sunTile.title }}
            </h3>
            <strong class="wx-tile-value">{{ sunTile.value }}</strong>
            <span class="wx-tile-note">{{ sunTile.note }}</span>
          </section>
          <section class="wx-panel wx-tile">
            <h3 class="wx-panel-title">
              {{ t('weather.precipitation') }}
            </h3>
            <strong class="wx-tile-value">{{ weather.current.precipitation ?? 0 }}<small>{{ weather.current.precipitationUnit ?? 'mm' }}</small></strong>
            <span v-if="today?.precipitationProbability !== undefined" class="wx-tile-note">{{ t('weather.precipitationChance', { value: today.precipitationProbability }) }}</span>
          </section>
          <section v-if="visibility" class="wx-panel wx-tile">
            <h3 class="wx-panel-title">
              {{ t('weather.visibility') }}
            </h3>
            <strong class="wx-tile-value">{{ visibility }}</strong>
          </section>
          <section v-if="weather.current.pressure" class="wx-panel wx-tile">
            <h3 class="wx-panel-title">
              {{ t('weather.pressure') }}
            </h3>
            <strong class="wx-tile-value">{{ round(weather.current.pressure) }}<small>hPa</small></strong>
          </section>
        </div>

        <footer class="wx-footer">
          <span>{{ updatedLabel }}</span>
          <button class="wx-footer-refresh" type="button" :disabled="loading" @click="refresh">
            ↻ {{ t('weather.refresh') }}
          </button>
          <a class="weather-source" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>
        </footer>
      </div>
    </template>
    <div v-else-if="failed" class="widget-failure" role="status">
      <WeatherGlyph class="wx-state-icon" kind="unknown" />
      <span>{{ t('weather.unavailable') }}</span>
      <button class="wx-retry" type="button" :disabled="loading" @click="refresh">
        {{ t('common.retry') }}
      </button>
    </div>
    <div v-else class="weather-placeholder">
      <WeatherGlyph class="wx-state-icon" kind="partlyCloudy" />
      <span>{{ t('weather.loading') }}</span>
    </div>
    <button v-if="layout !== 'detail' && weather" class="weather-refresh" type="button" :disabled="loading" :title="t('weather.refresh')" @click="refresh">
      <span aria-hidden="true">↻</span>
      <span class="sr-only">{{ t('weather.refresh') }}</span>
    </button>
  </section>
</template>

<style scoped>
.weather-card {
  --sky-top: #3a7bc8;
  --sky-mid: #6ea6dc;
  --sky-bottom: #9cc3e6;
  --wx-panel: rgb(0 32 72 / 16%);
  --wx-divider: rgb(255 255 255 / 20%);
  --wx-muted: rgb(255 255 255 / 72%);
  --wx-fall: 280px;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 12px 14px;
  border-radius: 18px;
  color: white;
  background: linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 60%, var(--sky-bottom) 100%);
  box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%));
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', sans-serif;
  text-shadow: 0 1px 2px rgb(0 0 0 / 12%);
  isolation: isolate;
}

.sky-clear-day { --sky-top: #1d6fd1; --sky-mid: #4b9de9; --sky-bottom: #7bbff4; }
.sky-clear-night { --sky-top: #060d24; --sky-mid: #15234a; --sky-bottom: #2a3c69; --wx-panel: rgb(255 255 255 / 8%); }
.sky-partly-day { --sky-top: #3a7bc8; --sky-mid: #6ba3d9; --sky-bottom: #98bfe2; }
.sky-partly-night { --sky-top: #101932; --sky-mid: #253558; --sky-bottom: #3c4d70; --wx-panel: rgb(255 255 255 / 8%); }
.sky-cloudy-day { --sky-top: #5a6f84; --sky-mid: #7d91a4; --sky-bottom: #9eadbc; --wx-panel: rgb(20 32 48 / 16%); }
.sky-cloudy-night { --sky-top: #1c2430; --sky-mid: #313c4a; --sky-bottom: #46515e; --wx-panel: rgb(255 255 255 / 8%); }
.sky-rain-day { --sky-top: #3d5164; --sky-mid: #5c7083; --sky-bottom: #788a9b; --wx-panel: rgb(10 20 32 / 18%); }
.sky-rain-night { --sky-top: #131b25; --sky-mid: #25313f; --sky-bottom: #364351; --wx-panel: rgb(255 255 255 / 8%); }
.sky-snow-day { --sky-top: #6a83a0; --sky-mid: #8ca3bb; --sky-bottom: #aabbcd; --wx-panel: rgb(20 36 60 / 16%); }
.sky-snow-night { --sky-top: #1e293b; --sky-mid: #35445b; --sky-bottom: #4b5a71; --wx-panel: rgb(255 255 255 / 8%); }
.sky-fog-day { --sky-top: #66717c; --sky-mid: #848e98; --sky-bottom: #9da6af; --wx-panel: rgb(20 28 36 / 18%); }
.sky-fog-night { --sky-top: #24282d; --sky-mid: #393e44; --sky-bottom: #4c5259; --wx-panel: rgb(255 255 255 / 8%); }
.sky-storm-day { --sky-top: #252a3b; --sky-mid: #3b4257; --sky-bottom: #545c73; --wx-panel: rgb(255 255 255 / 8%); }
.sky-storm-night { --sky-top: #0e111a; --sky-mid: #1e2332; --sky-bottom: #2e3446; --wx-panel: rgb(255 255 255 / 7%); }

/* Sky layer */
.weather-sky { position: absolute; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
.weather-sky > span { position: absolute; display: block; }
.sky-glow { top: -45%; right: -25%; width: 90%; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle, rgb(255 240 190 / 50%) 0%, rgb(255 230 160 / 18%) 35%, transparent 68%); }
.weather-card[class*='-night'] .sky-glow { background: radial-gradient(circle, rgb(210 220 255 / 16%) 0%, transparent 60%); }
.sky-stars {
  inset: 0;
  background-image:
    radial-gradient(1.2px 1.2px at 12% 18%, white 50%, transparent),
    radial-gradient(1px 1px at 28% 62%, rgb(255 255 255 / 80%) 50%, transparent),
    radial-gradient(1.4px 1.4px at 46% 12%, white 50%, transparent),
    radial-gradient(1px 1px at 63% 44%, rgb(255 255 255 / 70%) 50%, transparent),
    radial-gradient(1.2px 1.2px at 78% 22%, white 50%, transparent),
    radial-gradient(1px 1px at 88% 70%, rgb(255 255 255 / 75%) 50%, transparent),
    radial-gradient(1px 1px at 36% 84%, rgb(255 255 255 / 60%) 50%, transparent),
    radial-gradient(1.2px 1.2px at 6% 52%, rgb(255 255 255 / 85%) 50%, transparent);
  background-size: 260px 180px;
  animation: wx-twinkle 5s ease-in-out infinite alternate;
}
.sky-cloud { width: 70%; height: 46%; border-radius: 50%; background: rgb(255 255 255 / 26%); filter: blur(18px); animation: wx-drift 38s ease-in-out infinite alternate; }
.cloud-a { top: -14%; left: -18%; }
.cloud-b { top: 8%; right: -30%; width: 60%; animation-duration: 46s; animation-delay: -12s; opacity: .8; }
.cloud-c { bottom: -18%; left: 10%; width: 90%; animation-duration: 54s; animation-delay: -20s; opacity: .7; }
.sky-partly-day .sky-cloud, .sky-partly-night .sky-cloud { opacity: .55; }
.sky-storm-day .sky-cloud, .weather-card[class*='-night'] .sky-cloud { background: rgb(150 165 190 / 22%); }
.sky-fog { left: -20%; width: 140%; height: 34%; border-radius: 50%; background: rgb(255 255 255 / 22%); filter: blur(16px); animation: wx-drift 24s ease-in-out infinite alternate; }
.fog-a { top: 30%; }
.fog-b { bottom: -6%; animation-duration: 31s; animation-direction: alternate-reverse; }
.sky-drop { top: -20%; width: 1.5px; height: calc(18px * var(--particle-scale, 1)); border-radius: 1px; background: linear-gradient(to bottom, transparent, rgb(200 230 255 / 85%)); transform: rotate(12deg); animation: wx-rain linear infinite; }
.sky-flake { top: -6%; width: calc(5px * var(--particle-scale, 1)); aspect-ratio: 1; border-radius: 50%; background: white; filter: blur(.4px); animation: wx-snow linear infinite; }
.sky-flash { inset: 0; background: rgb(255 255 255 / 55%); opacity: 0; animation: wx-flash 9s linear infinite; }

@keyframes wx-twinkle { from { opacity: .55; } to { opacity: 1; } }
@keyframes wx-drift { from { transform: translateX(-6%); } to { transform: translateX(8%); } }
@keyframes wx-rain { from { transform: translate3d(0, 0, 0) rotate(12deg); } to { transform: translate3d(-40px, var(--wx-fall), 0) rotate(12deg); } }
@keyframes wx-snow { 0% { transform: translate3d(0, 0, 0); } 50% { transform: translate3d(10px, calc(var(--wx-fall) / 2), 0); } 100% { transform: translate3d(-6px, var(--wx-fall), 0); } }
@keyframes wx-flash { 0%, 61%, 66%, 100% { opacity: 0; } 62% { opacity: .9; } 63% { opacity: .1; } 64% { opacity: .7; } }

@media (prefers-reduced-motion: reduce) {
  .weather-sky > span { animation: none !important; }
  .sky-drop, .sky-flake, .sky-flash { display: none; }
}

/* Shared text */
.wx-city { overflow: hidden; font-size: 13px; font-weight: 600; line-height: 17px; white-space: nowrap; text-overflow: ellipsis; }
.wx-temp { font-size: 40px; font-weight: 300; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.weather-stale { color: #fde68a; }

/* Compact (one row / header) */
.weather-card.is-compact { justify-content: center; padding: 6px 12px; }
.wx-compact { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wx-compact-icon { flex: none; width: 30px; height: 30px; }
.wx-compact-temp { font-size: 26px; font-weight: 300; line-height: 1; }
.wx-compact-text { display: flex; flex-direction: column; min-width: 0; font-size: 11px; line-height: 15px; }
.wx-compact-text span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.wx-compact-text span:not(.wx-city) { color: var(--wx-muted); }
.wx-compact-range-inline { display: none; }
.wx-compact-text .wx-city { font-size: 12px; line-height: 15px; }
.wx-compact-range { margin-left: auto; padding-right: 10px; font-size: 11px; font-weight: 500; white-space: nowrap; }

/* Small (2×2) */
.wx-small { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.wx-small .wx-temp { margin-top: 2px; font-size: clamp(32px, 26cqw, 44px); }
.wx-small-foot { display: flex; flex-direction: column; gap: 1px; margin-top: auto; font-size: 11px; font-weight: 600; line-height: 14px; }
.wx-small-foot span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.wx-small-icon { width: 20px; height: 20px; margin-bottom: 2px; }

/* Medium (3–4 × 2) */
.wx-medium { display: flex; flex: 1; flex-direction: column; justify-content: space-between; gap: 6px; min-height: 0; }
.wx-medium-top { display: flex; justify-content: space-between; gap: 10px; min-width: 0; }
.wx-headline { display: flex; flex-direction: column; min-width: 0; }
.wx-headline .wx-temp { margin-top: 2px; }
.wx-summary { display: flex; flex: none; flex-direction: column; align-items: flex-end; gap: 1px; padding-right: 2px; font-size: 11px; font-weight: 600; line-height: 14px; text-align: right; white-space: nowrap; }
.wx-summary-icon { width: 22px; height: 22px; margin-bottom: 2px; }
.wx-strip { display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.wx-strip li { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
.wx-strip-label { max-width: 100%; overflow: hidden; color: var(--wx-muted); font-size: 10.5px; font-weight: 600; line-height: 13px; white-space: nowrap; text-overflow: ellipsis; }
.wx-strip-icon { width: 20px; height: 20px; }
.wx-strip-temp { font-size: 12px; font-weight: 600; line-height: 14px; }

@container (max-width: 290px) {
  .wx-compact-range { display: none; }
  .wx-compact-range-inline { display: block; }
}

@container (max-width: 200px) {
  .wx-compact-range-inline { display: none; }
}

@container (max-width: 250px) {
  .wx-medium .wx-temp { font-size: 32px; }
}

/* Detail (enlarged) */
.weather-card.is-detail { --wx-fall: 1100px; display: block; overflow-y: auto; padding: 24px; border-radius: 22px; scrollbar-width: none; }
.weather-card.is-detail::-webkit-scrollbar { display: none; }
.wx-detail {
  display: grid;
  grid-template-areas: 'hero hourly' 'daily tiles' 'footer footer';
  grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.wx-hero { display: flex; grid-area: hero; flex-direction: column; align-items: center; align-self: center; min-width: 0; text-align: center; }
.wx-hero-city { max-width: 100%; overflow: hidden; font-size: 30px; font-weight: 400; line-height: 1.2; white-space: nowrap; text-overflow: ellipsis; }
.wx-hero-temp { margin: 2px 0 0 .25em; font-size: 92px; font-weight: 200; line-height: 1; letter-spacing: -.03em; }
.wx-hero-condition { font-size: 18px; font-weight: 500; line-height: 24px; color: var(--wx-muted); }
.wx-hero-range { font-size: 18px; font-weight: 500; line-height: 24px; }
.wx-hero-meta { margin-top: 6px; color: var(--wx-muted); font-size: 12px; line-height: 16px; }
.wx-panel { min-width: 0; padding: 10px 14px 12px; border-radius: 16px; background: var(--wx-panel); backdrop-filter: blur(18px); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 8%); }
.wx-panel-title { margin: 0 0 8px; padding-bottom: 7px; border-bottom: 1px solid var(--wx-divider); color: var(--wx-muted); font-size: 12px; font-weight: 600; line-height: 16px; letter-spacing: .02em; text-transform: uppercase; }
.wx-hourly { grid-area: hourly; align-self: stretch; display: flex; flex-direction: column; justify-content: center; }
.wx-hours { display: flex; margin: 0; padding: 0; overflow-x: auto; list-style: none; scrollbar-width: none; overscroll-behavior-x: contain; }
.wx-hours::-webkit-scrollbar { display: none; }
.wx-hours li { display: flex; flex: none; flex-direction: column; align-items: center; gap: 4px; width: 58px; }
.wx-hour-label { font-size: 13px; font-weight: 600; line-height: 18px; white-space: nowrap; }
.wx-hour-icon { width: 28px; height: 28px; }
.wx-chance { color: #8fd8ff; font-size: 11px; font-weight: 700; line-height: 13px; }
.wx-chance.is-hidden { visibility: hidden; }
.wx-hour-temp { font-size: 17px; font-weight: 500; line-height: 22px; }
.wx-daily { grid-area: daily; }
.wx-days { margin: 0; padding: 0; list-style: none; }
.wx-days li { display: grid; grid-template-columns: 52px 38px 34px minmax(40px, 1fr) 34px; align-items: center; gap: 8px; min-height: 42px; border-top: 1px solid var(--wx-divider); font-size: 16px; font-weight: 500; }
.wx-days li:first-child { border-top: 0; }
.wx-day-label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.wx-day-icon { display: flex; flex-direction: column; align-items: center; }
.wx-day-icon svg { width: 26px; height: 26px; }
.wx-day-low { color: var(--wx-muted); text-align: right; }
.wx-day-high { text-align: right; }
.wx-range { position: relative; height: 5px; border-radius: 3px; background: rgb(0 0 0 / 18%); }
.wx-range-fill { position: absolute; top: 0; bottom: 0; border-radius: 3px; }
.wx-range-dot { position: absolute; top: 50%; width: 7px; height: 7px; border: 1.5px solid rgb(0 0 0 / 35%); border-radius: 50%; background: white; transform: translate(-50%, -50%); box-sizing: content-box; }
.wx-tiles { display: grid; grid-area: tiles; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.wx-tile { display: flex; flex-direction: column; min-height: 132px; }
.wx-tile-value { font-size: 30px; font-weight: 400; line-height: 1.15; white-space: nowrap; }
.wx-tile-value small { margin-left: 4px; font-size: 15px; font-weight: 500; }
.wx-tile-note { margin-top: auto; padding-top: 8px; color: var(--wx-muted); font-size: 12.5px; line-height: 16px; }
.wx-wind-body { display: flex; flex: 1; align-items: center; justify-content: space-between; gap: 6px; }
.wx-wind-body .wx-tile-note { display: block; margin: 0; }
.wx-compass { flex: none; width: 64px; height: 64px; }
.wx-uv-bar { position: relative; height: 5px; margin-top: auto; border-radius: 3px; background: linear-gradient(90deg, #34c759, #ffd60a 35%, #ff9f0a 60%, #ff453a 80%, #bf5af2); }
.wx-uv-dot { position: absolute; top: 50%; width: 7px; height: 7px; border: 1.5px solid rgb(0 0 0 / 35%); border-radius: 50%; background: white; transform: translate(-50%, -50%); box-sizing: content-box; }
.wx-footer { display: flex; grid-area: footer; align-items: center; gap: 14px; padding: 2px 4px 0; color: var(--wx-muted); font-size: 12px; }
.wx-footer-refresh { padding: 3px 10px; border: 1px solid rgb(255 255 255 / 25%); border-radius: 999px; color: inherit; background: rgb(255 255 255 / 10%); cursor: pointer; font: inherit; }
.wx-footer-refresh:hover:not(:disabled) { color: white; background: rgb(255 255 255 / 18%); }
.wx-footer-refresh:disabled { cursor: wait; opacity: .5; }
.weather-source { margin-left: auto; color: inherit; text-decoration: none; }
.weather-source:hover { color: white; text-decoration: underline; }

@container (max-width: 760px) {
  .weather-card.is-detail { padding: 18px 14px; }
  .wx-detail { grid-template-areas: 'hero' 'hourly' 'daily' 'tiles' 'footer'; grid-template-columns: minmax(0, 1fr); }
  .wx-hero { padding: 8px 0 6px; }
  .wx-hero-temp { font-size: 80px; }
  .wx-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
}

/* States and controls */
.weather-refresh {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: white;
  background: rgb(0 0 0 / 16%);
  cursor: pointer;
  opacity: 0;
  font-size: 12px;
  transition: opacity .15s ease;
}
.weather-card:hover > .weather-refresh, .weather-refresh:focus-visible { opacity: 1; }
.weather-refresh:disabled { cursor: wait; opacity: .45; }
.weather-placeholder, .widget-failure { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 0; font-size: 12px; line-height: 16px; text-align: center; }
.wx-state-icon { width: 32px; height: 32px; }
.wx-retry { padding: 4px 14px; border: 1px solid rgb(255 255 255 / 30%); border-radius: 999px; color: white; background: rgb(255 255 255 / 14%); cursor: pointer; font: inherit; font-size: 12px; }
.wx-retry:disabled { cursor: wait; opacity: .5; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
