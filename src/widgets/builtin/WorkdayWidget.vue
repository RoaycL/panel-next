<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  title?: string
  endTime?: string
  weekdaysOnly?: boolean
  expanded?: boolean
}>(), {
  title: '',
  endTime: '18:00',
  weekdaysOnly: true,
})

const { locale, t } = useI18n()
const now = ref(new Date())
const timer = window.setInterval(() => { now.value = new Date() }, 1000)
onUnmounted(() => window.clearInterval(timer))

const heading = computed(() => props.title.trim() || t('workdayWidget.title'))
const state = computed(() => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(props.endTime))
    return { kind: 'invalid' as const, seconds: 0 }
  const weekday = now.value.getDay()
  if (props.weekdaysOnly && (weekday === 0 || weekday === 6))
    return { kind: 'rest' as const, seconds: 0 }
  const [hour, minute] = props.endTime.split(':').map(Number)
  const end = new Date(now.value.getFullYear(), now.value.getMonth(), now.value.getDate(), hour, minute)
  const seconds = Math.max(0, Math.ceil((end.getTime() - now.value.getTime()) / 1000))
  return { kind: seconds > 0 ? 'running' as const : 'done' as const, seconds }
})

const clockParts = computed(() => {
  const total = state.value.seconds
  return [
    { key: 'hours', value: String(Math.floor(total / 3600)).padStart(2, '0'), label: t('workdayWidget.hours') },
    { key: 'minutes', value: String(Math.floor((total % 3600) / 60)).padStart(2, '0'), label: t('workdayWidget.minutes') },
    { key: 'seconds', value: String(total % 60).padStart(2, '0'), label: t('workdayWidget.seconds') },
  ]
})

// Monday-first week strip; weekends read as days off when the timer only counts weekdays.
const week = computed(() => {
  const today = now.value
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7)
  const formatter = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)
    const isToday = date.toDateString() === today.toDateString()
    return {
      key: index,
      label: formatter.format(date),
      day: date.getDate(),
      isToday,
      isPast: date < today && !isToday,
      isRest: props.weekdaysOnly && index >= 5,
    }
  })
})

const clock = computed(() => {
  const hours = Math.floor(state.value.seconds / 3600)
  const minutes = Math.floor((state.value.seconds % 3600) / 60)
  const seconds = state.value.seconds % 60
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
})
</script>

<template>
  <section v-if="expanded" class="workday-card workday-detail" :class="`is-${state.kind}`" :aria-label="heading">
    <header class="wd-header">
      <span class="workday-icon" aria-hidden="true">⏱</span>
      <h3>{{ heading }}</h3>
      <span class="wd-off">{{ t('workdayWidget.offAt', { time: endTime }) }}</span>
    </header>
    <div class="wd-hero">
      <div v-if="state.kind === 'running'" class="wd-digits" role="timer" :aria-label="clock">
        <template v-for="(part, index) in clockParts" :key="part.key">
          <span v-if="index" class="wd-colon" aria-hidden="true">:</span>
          <span class="wd-digit">
            <strong>{{ part.value }}</strong>
            <small>{{ part.label }}</small>
          </span>
        </template>
      </div>
      <strong v-else class="wd-message">{{ t(`workdayWidget.${state.kind}`) }}</strong>
      <span class="wd-caption">{{ state.kind === 'running' ? t('workdayWidget.until', { time: endTime }) : t('workdayWidget.localTime') }}</span>
    </div>
    <div class="wd-week">
      <span class="wd-week-title">{{ t('workdayWidget.week') }}</span>
      <ol>
        <li v-for="day in week" :key="day.key" :class="{ 'is-today': day.isToday, 'is-past': day.isPast, 'is-rest': day.isRest }">
          <span>{{ day.label }}</span>
          <strong>{{ day.day }}</strong>
        </li>
      </ol>
    </div>
  </section>
  <section v-else class="workday-card" :aria-label="heading">
    <header>
      <span class="workday-icon" aria-hidden="true">⏱</span>
      <h3>{{ heading }}</h3>
    </header>
    <div class="workday-main">
      <strong v-if="state.kind === 'running'" role="timer">{{ clock }}</strong>
      <strong v-else class="workday-message">{{ t(`workdayWidget.${state.kind}`) }}</strong>
      <span v-if="state.kind === 'running'">{{ t('workdayWidget.until', { time: endTime }) }}</span>
      <span v-else>{{ t('workdayWidget.localTime') }}</span>
    </div>
  </section>
</template>

<style scoped>
.workday-card { display: flex; flex-direction: column; justify-content: space-between; gap: 8px; width: 100%; height: 100%; min-height: 0; overflow: hidden; padding: 14px 18px; border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%)); border-radius: var(--pn-radius-large, 16px); color: var(--pn-widget-text-color, white); background: linear-gradient(135deg, color-mix(in srgb, var(--pn-color-accent, #10b981) 10%, transparent), transparent 54%), var(--pn-widget-background, rgb(18 25 39 / 42%)); box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%)); backdrop-filter: blur(var(--pn-effect-blur, 14px)); }
.workday-card header { display: flex; flex: none; align-items: center; gap: 8px; }
.workday-icon { display: grid; flex: none; width: 22px; height: 22px; place-items: center; border-radius: 7px; color: var(--pn-color-accent, #10b981); background: color-mix(in srgb, var(--pn-color-accent, #10b981) 13%, transparent); font-size: 14px; }
.workday-card h3 { overflow: hidden; margin: 0; font-size: 14px; font-weight: 700; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.workday-main { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; }
.workday-main strong { font-variant-numeric: tabular-nums; font-size: clamp(22px, 13cqw, 46px); font-weight: 600; letter-spacing: -.04em; line-height: 1.1; white-space: nowrap; }
.workday-main strong.workday-message { font-size: clamp(18px, 10cqw, 34px); white-space: normal; overflow-wrap: anywhere; }
.workday-detail { justify-content: flex-start; gap: 0; padding: 24px 30px; border-radius: 22px; }
.wd-header { display: flex; align-items: center; gap: 10px; }
.wd-header h3 { font-size: 18px; }
.wd-header .workday-icon { width: 30px; height: 30px; border-radius: 10px; font-size: 17px; }
.wd-off { margin-left: auto; padding: 4px 12px; border-radius: 999px; color: var(--pn-color-accent, #10b981); background: color-mix(in srgb, var(--pn-color-accent, #10b981) 14%, transparent); font-size: 13px; font-weight: 600; }
.wd-hero { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-height: 0; }
.wd-digits { display: flex; align-items: flex-start; gap: 10px; }
.wd-digit { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.wd-digit strong { display: grid; min-width: 1.35em; padding: 6px 14px; place-items: center; border-radius: 22px; background: var(--pn-widget-retry-background, rgb(255 255 255 / 8%)); box-shadow: inset 0 0 0 1px var(--pn-widget-border, rgb(255 255 255 / 12%)); font-size: clamp(56px, 12cqw, 120px); font-weight: 300; line-height: 1.1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.wd-digit small { color: var(--pn-widget-muted-text, rgb(255 255 255 / 60%)); font-size: 13px; font-weight: 600; }
.wd-colon { padding-top: .25em; color: var(--pn-widget-muted-text, rgb(255 255 255 / 45%)); font-size: clamp(40px, 8cqw, 80px); font-weight: 200; line-height: 1; }
.wd-message { font-size: clamp(36px, 7cqw, 64px); font-weight: 600; }
.wd-caption { color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 15px; }
.wd-week { padding-top: 16px; border-top: 1px solid var(--pn-widget-border, rgb(255 255 255 / 12%)); }
.wd-week-title { color: var(--pn-widget-muted-text, rgb(255 255 255 / 60%)); font-size: 12px; font-weight: 600; }
.wd-week ol { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.wd-week li { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0; border-radius: 14px; background: var(--pn-widget-retry-background, rgb(255 255 255 / 6%)); }
.wd-week li span { color: var(--pn-widget-muted-text, rgb(255 255 255 / 60%)); font-size: 12px; }
.wd-week li strong { font-size: 18px; font-weight: 600; }
.wd-week li.is-past { opacity: .45; }
.wd-week li.is-rest strong { color: var(--pn-widget-muted-text, rgb(255 255 255 / 55%)); }
.wd-week li.is-today { color: white; background: var(--pn-color-accent, #10b981); }
.wd-week li.is-today span { color: rgb(255 255 255 / 85%); }
@container (max-width: 560px) { .workday-detail { padding: 18px 16px; } .wd-digits { gap: 4px; } .wd-digit strong { padding: 4px 8px; border-radius: 14px; } .wd-week ol { gap: 4px; } }
.workday-main span { color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 11px; }
</style>
