<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isChineseLocale, lunarDate } from './lunar'

const props = defineProps<{ expanded?: boolean }>()
const { locale, t } = useI18n()
const today = ref(new Date())
const visibleMonth = ref(new Date(today.value.getFullYear(), today.value.getMonth(), 1))
const refreshTimer = window.setInterval(() => { today.value = new Date() }, 60 * 1000)
onUnmounted(() => window.clearInterval(refreshTimer))

const monthLabel = computed(() => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }).format(visibleMonth.value))
const weekdayLabels = computed(() => Array.from({ length: 7 }, (_, index) => {
  const monday = new Date(2024, 0, 1 + index)
  return new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(monday)
}))
// The enlarged view lets you pick a day; the side panel describes it.
const selected = ref(new Date(today.value))
const showLunar = computed(() => isChineseLocale(locale.value))
const days = computed(() => {
  const year = visibleMonth.value.getFullYear()
  const month = visibleMonth.value.getMonth()
  const offset = (new Date(year, month, 1).getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, month, index - offset + 1)
    return {
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      day: date.getDate(),
      currentMonth: date.getMonth() === month,
      isToday: date.getFullYear() === today.value.getFullYear()
        && date.getMonth() === today.value.getMonth()
        && date.getDate() === today.value.getDate(),
      label: new Intl.DateTimeFormat(locale.value, { dateStyle: 'full' }).format(date),
      date,
      weekend: date.getDay() === 0 || date.getDay() === 6,
      isSelected: sameDay(date, selected.value),
      lunar: props.expanded && showLunar.value ? lunarDate(date) : null,
    }
  })
})

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

const selectedInfo = computed(() => {
  const date = selected.value
  const start = new Date(today.value.getFullYear(), today.value.getMonth(), today.value.getDate())
  const offset = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - start.getTime()) / 86400000)
  // ISO week number: the week containing Thursday decides the year.
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 3 - (date.getDay() + 6) % 7)
  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86400000 - 3 + (firstThursday.getDay() + 6) % 7) / 7)
  const lunar = showLunar.value ? lunarDate(date) : null
  return {
    weekday: new Intl.DateTimeFormat(locale.value, { weekday: 'long' }).format(date),
    day: date.getDate(),
    month: new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }).format(date),
    lunar: lunar ? t('calendarWidget.lunar', { value: `${lunar.month}${lunar.day}` }) : '',
    festival: lunar?.festival ?? '',
    relative: offset === 0 ? t('calendarWidget.today') : t(offset > 0 ? 'calendarWidget.daysAhead' : 'calendarWidget.daysAgo', { count: Math.abs(offset) }),
    week: t('calendarWidget.weekNumber', { week }),
  }
})

function selectDay(date: Date) {
  selected.value = date
  if (date.getMonth() !== visibleMonth.value.getMonth() || date.getFullYear() !== visibleMonth.value.getFullYear())
    visibleMonth.value = new Date(date.getFullYear(), date.getMonth(), 1)
}

function changeMonth(delta: number) {
  visibleMonth.value = new Date(visibleMonth.value.getFullYear(), visibleMonth.value.getMonth() + delta, 1)
}

function goToToday() {
  visibleMonth.value = new Date(today.value.getFullYear(), today.value.getMonth(), 1)
  selected.value = new Date(today.value)
}
</script>

<template>
  <section v-if="expanded" class="calendar-card calendar-detail" :aria-label="t('calendarWidget.title')">
    <aside class="cal-side">
      <span class="cal-side-weekday">{{ selectedInfo.weekday }}</span>
      <strong class="cal-side-day">{{ selectedInfo.day }}</strong>
      <span class="cal-side-month">{{ selectedInfo.month }}</span>
      <span v-if="selectedInfo.lunar" class="cal-side-lunar">{{ selectedInfo.lunar }}</span>
      <span v-if="selectedInfo.festival" class="cal-side-festival">{{ selectedInfo.festival }}</span>
      <dl class="cal-side-facts">
        <div><dt>{{ selectedInfo.relative }}</dt></div>
        <div><dt>{{ selectedInfo.week }}</dt></div>
      </dl>
    </aside>
    <div class="cal-main">
      <header class="cal-main-header">
        <h3>{{ monthLabel }}</h3>
        <div class="cal-nav">
          <button type="button" class="cal-nav-button" :aria-label="t('calendarWidget.previous')" @click="changeMonth(-1)">
            ‹
          </button>
          <button type="button" class="cal-nav-button cal-nav-today" @click="goToToday">
            {{ t('calendarWidget.today') }}
          </button>
          <button type="button" class="cal-nav-button" :aria-label="t('calendarWidget.next')" @click="changeMonth(1)">
            ›
          </button>
        </div>
      </header>
      <div class="cal-weekdays" aria-hidden="true">
        <span v-for="(weekday, index) in weekdayLabels" :key="index" :class="{ 'is-weekend': index >= 5 }">{{ weekday }}</span>
      </div>
      <div class="cal-grid" role="grid" :aria-label="monthLabel">
        <button
          v-for="day in days"
          :key="day.key"
          type="button"
          class="cal-cell"
          :class="{ 'is-outside': !day.currentMonth, 'is-today': day.isToday, 'is-selected': day.isSelected, 'is-weekend': day.weekend }"
          :aria-label="day.label"
          :aria-current="day.isToday ? 'date' : undefined"
          :aria-pressed="day.isSelected"
          role="gridcell"
          @click="selectDay(day.date)"
        >
          <span class="cal-cell-day">{{ day.day }}</span>
          <span v-if="day.lunar" class="cal-cell-lunar" :class="{ 'is-festival': day.lunar.festival }">{{ day.lunar.festival || (day.lunar.day === '初一' ? day.lunar.month : day.lunar.day) }}</span>
        </button>
      </div>
    </div>
  </section>
  <section v-else class="calendar-card" :aria-label="t('calendarWidget.title')">
    <header class="calendar-header">
      <h3>{{ monthLabel }}</h3>
      <div class="calendar-actions">
        <button type="button" :aria-label="t('calendarWidget.previous')" @click="changeMonth(-1)">
          ‹
        </button>
        <button type="button" class="today-action" @click="goToToday">
          {{ t('calendarWidget.today') }}
        </button>
        <button type="button" :aria-label="t('calendarWidget.next')" @click="changeMonth(1)">
          ›
        </button>
      </div>
    </header>
    <div class="calendar-grid" role="grid" :aria-label="monthLabel">
      <span v-for="(weekday, index) in weekdayLabels" :key="index" class="weekday" role="columnheader">{{ weekday }}</span>
      <span
        v-for="day in days"
        :key="day.key"
        class="calendar-day"
        :class="{ 'is-outside': !day.currentMonth, 'is-today': day.isToday }"
        :aria-label="day.label"
        :aria-current="day.isToday ? 'date' : undefined"
        role="gridcell"
      >{{ day.day }}</span>
    </div>
  </section>
</template>

<style scoped>
.calendar-card {
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%));
  border-radius: var(--pn-radius-large, 16px);
  color: var(--pn-widget-text-color, white);
  background: var(--pn-widget-background, rgb(18 25 39 / 42%));
  box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%));
  backdrop-filter: blur(var(--pn-effect-blur, 14px));
}
.calendar-header { display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-bottom: 4px; }
.calendar-header h3 { overflow: hidden; min-width: 0; margin: 0; font-size: 14px; line-height: 18px; font-weight: 700; white-space: nowrap; text-overflow: ellipsis; }
.calendar-actions { display: flex; align-items: center; gap: 2px; }
.calendar-actions button { min-width: 24px; min-height: 24px; padding: 0 4px; border: 0; border-radius: 6px; color: inherit; background: transparent; cursor: pointer; }
.calendar-actions button:hover { background: var(--pn-widget-retry-background, rgb(255 255 255 / 12%)); }
.calendar-actions .today-action { font-size: 11px; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px 2px; text-align: center; }
.weekday { overflow: hidden; white-space: nowrap; color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 10px; line-height: 14px; }
.calendar-day { display: grid; min-width: 0; height: 16px; place-items: center; border-radius: 5px; font-size: 10px; line-height: 1; }
.calendar-day.is-outside { opacity: .36; }
.calendar-day.is-today { color: var(--pn-color-surface, #0f172a); background: var(--pn-color-accent, #5eead4); font-weight: 800; opacity: 1; }
button:focus-visible { outline: 2px solid var(--pn-color-accent, #5eead4); outline-offset: 2px; }
/* Enlarged: a month view in the spirit of macOS Calendar. */
.calendar-detail { --cal-red: #ff3b30; display: grid; grid-template-columns: minmax(200px, 260px) minmax(0, 1fr); gap: 0; padding: 0; overflow: hidden; border-radius: 20px; }
.cal-side { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 28px 24px; border-right: 1px solid var(--pn-widget-border, rgb(255 255 255 / 12%)); background: color-mix(in srgb, var(--cal-red) 6%, transparent); }
.cal-side-weekday { color: var(--cal-red); font-size: 17px; font-weight: 600; }
.cal-side-day { font-size: 96px; font-weight: 300; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.cal-side-month { margin-top: 6px; font-size: 16px; font-weight: 600; }
.cal-side-lunar { color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 14px; }
.cal-side-festival { margin-top: 4px; padding: 2px 10px; border-radius: 999px; color: white; background: var(--cal-red); font-size: 12px; font-weight: 600; }
.cal-side-facts { display: flex; flex-direction: column; gap: 8px; width: 100%; margin: auto 0 0; padding-top: 16px; border-top: 1px solid var(--pn-widget-border, rgb(255 255 255 / 12%)); }
.cal-side-facts dt { color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 13px; }
.cal-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 20px 22px 18px; }
.cal-main-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.cal-main-header h3 { margin: 0; font-size: 26px; font-weight: 700; line-height: 1.2; letter-spacing: -.01em; }
.cal-nav { display: flex; align-items: center; gap: 4px; }
.cal-nav-button { min-width: 32px; height: 30px; padding: 0 10px; border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%)); border-radius: 8px; color: inherit; background: var(--pn-widget-retry-background, rgb(255 255 255 / 8%)); cursor: pointer; font: inherit; font-size: 18px; line-height: 1; }
.cal-nav-button.cal-nav-today { font-size: 13px; font-weight: 600; }
.cal-nav-button:hover { background: var(--pn-color-surface-hover, rgb(255 255 255 / 14%)); }
.cal-weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); padding-bottom: 6px; color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 12px; font-weight: 600; text-align: right; }
.cal-weekdays span { padding-right: 10px; }
.cal-weekdays .is-weekend, .cal-cell.is-weekend:not(.is-today) .cal-cell-day { color: var(--pn-widget-muted-text, rgb(255 255 255 / 60%)); }
.cal-grid { display: grid; flex: 1; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-template-rows: repeat(6, minmax(52px, 1fr)); border-top: 1px solid var(--pn-widget-border, rgb(255 255 255 / 12%)); border-left: 1px solid var(--pn-widget-border, rgb(255 255 255 / 12%)); }
.cal-cell { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 0; padding: 6px 8px; border: 0; border-right: 1px solid var(--pn-widget-border, rgb(255 255 255 / 12%)); border-bottom: 1px solid var(--pn-widget-border, rgb(255 255 255 / 12%)); color: inherit; background: transparent; cursor: pointer; font: inherit; text-align: right; }
.cal-cell:hover { background: var(--pn-color-surface-hover, rgb(255 255 255 / 6%)); }
.cal-cell.is-selected { background: color-mix(in srgb, var(--cal-red) 9%, transparent); }
.cal-cell.is-outside { opacity: .38; }
.cal-cell-day { display: grid; min-width: 28px; height: 28px; place-items: center; border-radius: 999px; font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums; }
.cal-cell.is-today .cal-cell-day { color: white; background: var(--cal-red); font-weight: 700; }
.cal-cell-lunar { overflow: hidden; max-width: 100%; color: var(--pn-widget-muted-text, rgb(255 255 255 / 60%)); font-size: 11px; line-height: 14px; white-space: nowrap; text-overflow: ellipsis; }
.cal-cell-lunar.is-festival { color: var(--cal-red); font-weight: 600; }
@container (max-width: 720px) {
  .calendar-detail { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .cal-side { flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 16px; border-right: 0; border-bottom: 1px solid var(--pn-widget-border, rgb(255 255 255 / 12%)); }
  .cal-side-day { font-size: 44px; }
  .cal-side-facts { flex-direction: row; width: auto; margin: 0; padding: 0; border: 0; }
  .cal-main { padding: 12px; }
  .cal-main-header h3 { font-size: 20px; }
  .cal-grid { grid-template-rows: repeat(6, minmax(44px, 1fr)); }
  .cal-cell { align-items: center; padding: 4px 2px; }
  .cal-weekdays { text-align: center; }
  .cal-weekdays span { padding: 0; }
}

@container (max-width: 270px) {
  .calendar-card { padding: 10px; }
  .calendar-grid { gap: 2px 0; }
  .calendar-day { height: 15px; }
  .calendar-header h3 { font-size: 11px; }
  .calendar-actions .today-action { display: none; }
}
</style>
