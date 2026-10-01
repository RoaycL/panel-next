<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

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
    }
  })
})

function changeMonth(delta: number) {
  visibleMonth.value = new Date(visibleMonth.value.getFullYear(), visibleMonth.value.getMonth() + delta, 1)
}

function goToToday() {
  visibleMonth.value = new Date(today.value.getFullYear(), today.value.getMonth(), 1)
}
</script>

<template>
  <section class="calendar-card" :aria-label="t('calendarWidget.title')">
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
@container (max-width: 270px) {
  .calendar-card { padding: 10px; }
  .calendar-grid { gap: 2px 0; }
  .calendar-day { height: 15px; }
  .calendar-header h3 { font-size: 11px; }
  .calendar-actions .today-action { display: none; }
}
</style>
