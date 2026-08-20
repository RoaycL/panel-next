<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  title?: string
  date?: string
  repeat?: 'none' | 'yearly'
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
  <section class="countdown-card" :aria-label="t('countdown.title')">
    <header class="countdown-header">
      <span class="countdown-icon" aria-hidden="true">{{ statusIcon }}</span>
      <span class="countdown-name" :title="displayTitle">{{ displayTitle }}</span>
    </header>
    <div v-if="status" class="countdown-body">
      <span v-if="status.kind === 'today'" class="countdown-today">{{ t('countdown.today') }}</span>
      <span v-else class="countdown-remaining">
        <strong>{{ status.days }}</strong>
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
  justify-content: center;
  gap: 4px;
  width: min(100%, 236px);
  min-height: 92px;
  padding: 12px 16px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 16px;
  color: white;
  background: rgb(18 25 39 / 42%);
  box-shadow: 0 10px 30px rgb(0 0 0 / 14%);
  backdrop-filter: blur(14px);
  text-shadow: none;
}

.countdown-header {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.countdown-icon {
  flex: none;
  font-size: 16px;
  line-height: 1;
}

.countdown-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.countdown-body {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.countdown-remaining {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}

.countdown-remaining strong {
  font-size: 30px;
  font-weight: 800;
  line-height: 1;
}

.countdown-unit {
  color: rgb(255 255 255 / 70%);
  font-size: 12px;
}

.countdown-today {
  color: #fde68a;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.countdown-date {
  width: 100%;
  color: rgb(255 255 255 / 55%);
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
}

.countdown-invalid {
  color: rgb(255 255 255 / 75%);
  font-size: 12px;
}

@media (max-width: 640px) {
  .countdown-card {
    width: 100%;
    min-height: 0;
  }
}
</style>
