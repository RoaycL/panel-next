<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  title?: string
  date?: string
  repeat?: 'none' | 'yearly'
  expanded?: boolean
}>(), {
  title: '',
  date: '',
  repeat: 'none',
})

const { locale, t } = useI18n()
const today = ref(startOfDay(new Date()))
const refreshTimer = window.setInterval(() => {
  const next = startOfDay(new Date())
  if (next.getTime() !== today.value.getTime())
    today.value = next
}, 60 * 1000)

onUnmounted(() => {
  window.clearInterval(refreshTimer)
})

type CountdownStatus =
  | { kind: 'today'; days: 0; date: Date }
  | { kind: 'remaining'; days: number; date: Date }
  | { kind: 'passed'; days: number; date: Date }

const targetDate = computed(() => parseLocalDate(props.date))
const status = computed<CountdownStatus | null>(() => {
  const target = targetDate.value
  if (!target)
    return null
  const now = today.value
  if (props.repeat === 'yearly') {
    if (now.getMonth() === target.getMonth() && now.getDate() === target.getDate())
      return { kind: 'today', days: 0, date: target }
    const next = nextYearlyOccurrence(now, target.getMonth(), target.getDate())
    return { kind: 'remaining', days: calendarDaysBetween(now, next), date: next }
  }
  const diff = calendarDaysBetween(now, target)
  if (diff === 0)
    return { kind: 'today', days: 0, date: target }
  if (diff > 0)
    return { kind: 'remaining', days: diff, date: target }
  return { kind: 'passed', days: -diff, date: target }
})

const displayTitle = computed(() => props.title.trim() || t('countdown.title'))
const statusIcon = computed(() => {
  if (!status.value)
    return '⚠️'
  if (status.value.kind === 'today')
    return '🎉'
  return status.value.kind === 'remaining' ? '⏳' : '📅'
})
const formattedDate = computed(() => status.value ? status.value.date.toLocaleDateString(locale.value) : '')
const fullDate = computed(() => status.value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'full' }).format(status.value.date) : '')
const stats = computed(() => {
  if (!status.value || status.value.kind === 'today')
    return []
  const days = status.value.days
  return [
    { label: t('countdown.inWeeks'), value: t('countdown.weeksDays', { weeks: Math.floor(days / 7), days: days % 7 }) },
    { label: t('countdown.inMonths'), value: t('countdown.months', { count: (days / 30.44).toFixed(days < 305 ? 1 : 0) }) },
    { label: t('countdown.inHours'), value: t('countdown.hours', { count: (days * 24).toLocaleString(locale.value) }) },
  ]
})

function parseLocalDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1900)
    return null
  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day)
    return null
  return probe
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function calendarDaysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

function nextYearlyOccurrence(now: Date, month: number, day: number) {
  const year = now.getFullYear()
  let candidate = clampToMonthEnd(year, month, day)
  if (calendarDaysBetween(now, candidate) < 0)
    candidate = clampToMonthEnd(year + 1, month, day)
  return candidate
}

function clampToMonthEnd(year: number, month: number, day: number) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastDay))
}
</script>

<template>
  <section v-if="expanded" class="countdown-card countdown-detail" :class="status ? `is-${status.kind}` : 'is-invalid'" :aria-label="t('countdown.title')">
    <header class="cd-header">
      <span class="cd-icon" aria-hidden="true">{{ statusIcon }}</span>
      <span class="cd-title" :title="displayTitle">{{ displayTitle }}</span>
      <span v-if="repeat === 'yearly'" class="cd-badge">{{ t('countdown.yearly') }}</span>
    </header>
    <div v-if="status" class="cd-hero">
      <strong v-if="status.kind === 'today'" class="cd-today">{{ t('countdown.today') }}</strong>
      <template v-else>
        <strong class="cd-number">{{ status.days }}</strong>
        <span class="cd-unit">{{ status.kind === 'remaining' ? t('countdown.daysRemaining') : t('countdown.daysPassed') }}</span>
      </template>
      <span class="cd-date">{{ fullDate }}</span>
    </div>
    <div v-else class="cd-hero">
      <span class="cd-unit">{{ t('countdown.invalid') }}</span>
    </div>
    <dl v-if="stats.length" class="cd-stats">
      <div v-for="stat in stats" :key="stat.label" class="cd-stat">
        <dt>{{ stat.label }}</dt>
        <dd>{{ stat.value }}</dd>
      </div>
    </dl>
  </section>
  <section v-else class="countdown-card" :aria-label="t('countdown.title')">
    <header class="countdown-header">
      <span class="countdown-icon" aria-hidden="true">{{ statusIcon }}</span>
      <span class="countdown-name" :title="displayTitle">{{ displayTitle }}</span>
    </header>
    <div v-if="status" class="countdown-body">
      <span v-if="status.kind === 'today'" class="countdown-today">{{ t('countdown.today') }}</span>
      <span v-else class="countdown-remaining">
        <strong :style="{ '--countdown-number-scale': `${Math.min(20, 72 / (String(status.days).length + .8))}cqw` }">{{ status.days }}</strong>
        <span class="countdown-unit">{{ status.kind === 'remaining' ? t('countdown.daysRemaining') : t('countdown.daysPassed') }}</span>
      </span>
      <span class="countdown-date">{{ formattedDate }}</span>
    </div>
    <div v-else class="countdown-invalid">
      {{ t('countdown.invalid') }}
    </div>
  </section>
</template>

<style scoped>
.countdown-card {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 0;
  padding: 12px 16px;
  border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%));
  border-radius: 16px;
  color: var(--pn-widget-text-color, white);
  background: var(--pn-widget-background, rgb(18 25 39 / 42%));
  box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%));
  backdrop-filter: blur(var(--pn-effect-blur, 14px));
  text-shadow: none;
}

.countdown-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: none;
}

.countdown-icon {
  display: grid;
  flex: none;
  width: 22px;
  height: 22px;
  place-items: center;
  font-size: 15px;
  line-height: 1;
}

.countdown-name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 700;
  line-height: 20px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.countdown-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 0;
}

.countdown-remaining {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.countdown-remaining strong {
  font-size: clamp(20px, var(--countdown-number-scale, 20cqw), 64px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -.04em;
  line-height: 1;
}

.countdown-unit {
  color: var(--pn-widget-muted-text, rgb(255 255 255 / 70%));
  font-size: 12px;
}

.countdown-today {
  color: var(--pn-notification-warning-color, #fde68a);
  font-size: clamp(22px, 12cqw, 38px);
  font-weight: 700;
  line-height: 1.2;
}

.countdown-date {
  width: 100%;
  color: var(--pn-widget-muted-text, rgb(255 255 255 / 55%));
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  text-align: center;
}

.countdown-invalid {
  color: var(--pn-widget-error-color, rgb(255 255 255 / 75%));
  font-size: 12px;
  flex: 1;
  display: grid;
  place-items: center;
}

/* Enlarged: one bold colour card, big number, and the same span in other units. */
.countdown-detail { --cd-from: #ff9f0a; --cd-to: #ff375f; justify-content: flex-start; gap: 0; height: 100%; padding: 26px 30px 24px; border: 0; border-radius: 22px; color: white; background: radial-gradient(circle at 85% 0%, rgb(255 255 255 / 22%), transparent 45%), linear-gradient(150deg, var(--cd-from), var(--cd-to)); }
.countdown-detail.is-passed { --cd-from: #5e5ce6; --cd-to: #0a84ff; }
.countdown-detail.is-today { --cd-from: #ffd60a; --cd-to: #ff9f0a; }
.countdown-detail.is-invalid { --cd-from: #636366; --cd-to: #3a3a3c; }
.cd-header { display: flex; align-items: center; gap: 10px; min-width: 0; }
.cd-icon { display: grid; flex: none; width: 36px; height: 36px; place-items: center; border-radius: 12px; background: rgb(255 255 255 / 22%); font-size: 20px; }
.cd-title { overflow: hidden; font-size: 22px; font-weight: 700; white-space: nowrap; text-overflow: ellipsis; }
.cd-badge { flex: none; padding: 3px 10px; border-radius: 999px; background: rgb(255 255 255 / 22%); font-size: 12px; font-weight: 600; }
.cd-hero { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 0; text-align: center; }
.cd-number { font-size: clamp(88px, 18cqw, 168px); font-weight: 700; line-height: .95; letter-spacing: -.05em; font-variant-numeric: tabular-nums; text-shadow: 0 6px 30px rgb(0 0 0 / 15%); }
.cd-unit { font-size: 22px; font-weight: 600; opacity: .9; }
.cd-today { font-size: clamp(48px, 9cqw, 88px); font-weight: 800; line-height: 1.1; }
.cd-date { margin-top: 10px; padding: 6px 14px; border-radius: 999px; background: rgb(0 0 0 / 14%); font-size: 15px; font-weight: 500; }
.cd-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; }
.cd-stat { padding: 14px 16px; border-radius: 16px; background: rgb(255 255 255 / 16%); backdrop-filter: blur(12px); }
.cd-stat dt { font-size: 12px; font-weight: 600; opacity: .8; }
.cd-stat dd { margin: 4px 0 0; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
@container (max-width: 560px) {
  .countdown-detail { padding: 18px 16px; }
  .cd-stats { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .cd-stat { display: flex; align-items: baseline; justify-content: space-between; padding: 10px 14px; }
}

@media (max-width: 640px) {
  .countdown-card {
    width: 100%;
    min-height: 0;
  }
}
</style>
