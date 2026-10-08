<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isChineseLocale, lunarDate } from './lunar'

// Enlarged view shared by the clock and date widgets: an analog face beside a large digital readout.
const { locale, t } = useI18n()
const now = ref(new Date())
const timer = window.setInterval(() => { now.value = new Date() }, 1000)
onUnmounted(() => window.clearInterval(timer))

const hours = computed(() => String(now.value.getHours()).padStart(2, '0'))
const minutes = computed(() => String(now.value.getMinutes()).padStart(2, '0'))
const seconds = computed(() => String(now.value.getSeconds()).padStart(2, '0'))
const dateLabel = computed(() => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now.value))
const lunar = computed(() => isChineseLocale(locale.value) ? lunarDate(now.value) : null)
const lunarLabel = computed(() => lunar.value ? t('calendarWidget.lunar', { value: `${lunar.value.month}${lunar.value.day}` }) : '')

const hands = computed(() => {
  const date = now.value
  const second = date.getSeconds()
  const minute = date.getMinutes() + second / 60
  const hour = date.getHours() % 12 + minute / 60
  return { hour: hour * 30, minute: minute * 6, second: second * 6 }
})
const ticks = Array.from({ length: 60 }, (_, index) => index)
const numerals = Array.from({ length: 12 }, (_, index) => {
  const angle = (index + 1) * 30 * Math.PI / 180
  return { value: index + 1, x: 100 + Math.sin(angle) * 70, y: 100 - Math.cos(angle) * 70 }
})
</script>

<template>
  <section class="clock-detail">
    <svg class="clock-face" viewBox="0 0 200 200" role="img" :aria-label="`${hours}:${minutes}`">
      <circle cx="100" cy="100" r="96" class="face-bg" />
      <line v-for="tick in ticks" :key="tick" x1="100" :y1="tick % 5 ? 10 : 8" x2="100" :y2="tick % 5 ? 14 : 18" class="face-tick" :class="{ 'is-hour': tick % 5 === 0 }" :transform="`rotate(${tick * 6} 100 100)`" />
      <text v-for="numeral in numerals" :key="numeral.value" :x="numeral.x" :y="numeral.y" class="face-numeral" text-anchor="middle" dominant-baseline="central">{{ numeral.value }}</text>
      <line x1="100" y1="100" x2="100" y2="54" class="hand-hour" :transform="`rotate(${hands.hour} 100 100)`" />
      <line x1="100" y1="100" x2="100" y2="30" class="hand-minute" :transform="`rotate(${hands.minute} 100 100)`" />
      <g :transform="`rotate(${hands.second} 100 100)`">
        <line x1="100" y1="118" x2="100" y2="22" class="hand-second" />
      </g>
      <circle cx="100" cy="100" r="4" class="hand-pin" />
    </svg>
    <div class="clock-readout">
      <strong class="clock-digits">{{ hours }}<span class="clock-colon">:</span>{{ minutes }}<small>{{ seconds }}</small></strong>
      <span class="clock-date-line">{{ dateLabel }}</span>
      <span v-if="lunarLabel" class="clock-lunar">{{ lunarLabel }}<span v-if="lunar?.festival" class="clock-festival">{{ lunar.festival }}</span></span>
    </div>
  </section>
</template>

<style scoped>
.clock-detail { display: grid; grid-template-columns: minmax(200px, 300px) minmax(0, 1fr); align-items: center; gap: 48px; height: 100%; padding: 32px 48px; border-radius: 22px; color: var(--pn-widget-text-color, white); background: var(--pn-widget-background, rgb(18 25 39 / 42%)); }
.clock-face { width: 100%; height: auto; }
.face-bg { fill: var(--pn-widget-retry-background, rgb(255 255 255 / 8%)); stroke: var(--pn-widget-border, rgb(255 255 255 / 16%)); stroke-width: 1.5; }
.face-tick { stroke: var(--pn-widget-muted-text, rgb(255 255 255 / 45%)); stroke-width: 1; stroke-linecap: round; }
.face-tick.is-hour { stroke: currentColor; stroke-width: 2.4; }
.face-numeral { fill: currentColor; font-size: 15px; font-weight: 600; }
.hand-hour, .hand-minute { stroke: currentColor; stroke-linecap: round; }
.hand-hour { stroke-width: 6; }
.hand-minute { stroke-width: 4; }
.hand-second { stroke: #ff9f0a; stroke-width: 1.6; stroke-linecap: round; }
.hand-pin { fill: #ff9f0a; stroke: var(--pn-widget-text-color, white); stroke-width: 1.5; }
.clock-readout { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.clock-digits { font-size: clamp(64px, 13cqw, 150px); font-weight: 200; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.clock-colon { margin: 0 .02em; opacity: .55; }
.clock-digits small { margin-left: .2em; color: var(--pn-widget-muted-text, rgb(255 255 255 / 55%)); font-size: .32em; font-weight: 400; letter-spacing: 0; }
.clock-date-line { font-size: clamp(18px, 2.6cqw, 26px); font-weight: 500; }
.clock-lunar { display: flex; align-items: center; gap: 10px; color: var(--pn-widget-muted-text, rgb(255 255 255 / 60%)); font-size: 16px; }
.clock-festival { padding: 2px 10px; border-radius: 999px; color: white; background: #ff3b30; font-size: 12px; font-weight: 600; }
@container (max-width: 640px) {
  .clock-detail { grid-template-columns: minmax(0, 1fr); justify-items: center; gap: 20px; padding: 20px 16px; text-align: center; }
  .clock-face { width: min(220px, 70%); }
  .clock-readout { align-items: center; }
  .clock-digits { font-size: 72px; }
}
</style>
