<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWidgetContext } from '../context'
import type { WorkdayExtra, WorkdayFont } from './workday'
import { WORKDAY_EXTRAS, WORKDAY_FONT_STACKS, daysUntilFriday, daysUntilPayday, formatClock, isoWeekday, nextFestival, workdayState } from './workday'

const props = withDefaults(defineProps<{
  title?: string
  workdays?: string
  startTime?: string
  endTime?: string
  background?: string
  backgroundImage?: string
  textColor?: string
  font?: WorkdayFont
  extras?: string
  payday?: number
  dailyIncome?: number
  expanded?: boolean
}>(), {
  title: '',
  workdays: '12345',
  startTime: '09:00',
  endTime: '18:00',
  background: 'theme',
  backgroundImage: '',
  textColor: 'theme',
  font: 'system',
  extras: 'payday,friday,holiday,income',
  payday: 10,
  dailyIncome: 400,
})

const { locale, t } = useI18n()
const context = useWidgetContext()
const now = ref(new Date())
const timer = window.setInterval(() => { now.value = new Date() }, 1000)
onUnmounted(() => window.clearInterval(timer))

const heading = computed(() => props.title.trim() || t('workdayWidget.title'))
const state = computed(() => workdayState(now.value, props))
const clock = computed(() => formatClock(state.value.seconds))
const counting = computed(() => state.value.kind === 'working' || state.value.kind === 'before')

// Grid size picks the layout: a wide card, a square, a one-row strip, or a small tile.
const layout = computed(() => {
  const size = context?.size ?? { columns: 4, rows: 2 }
  if (size.rows <= 1)
    return size.columns >= 3 ? 'strip' : 'mini'
  return size.columns >= 3 ? 'large' : 'square'
})

const mood = computed(() => ({ before: '☕', working: '🧑‍💻', done: '🎉', rest: '🛋️', invalid: '⏱' })[state.value.kind])
const headline = computed(() => counting.value ? clock.value : t(`workdayWidget.state.${state.value.kind}`))
const caption = computed(() => {
  switch (state.value.kind) {
    case 'working': return t('workdayWidget.until', { time: props.endTime })
    case 'before': return t('workdayWidget.untilStart', { time: props.startTime })
    case 'done': return t('workdayWidget.doneHint')
    case 'rest': return t('workdayWidget.restHint')
    default: return t('workdayWidget.timeHint')
  }
})

const enabledExtras = computed(() => props.extras.split(',').filter((extra): extra is WorkdayExtra => (WORKDAY_EXTRAS as readonly string[]).includes(extra)))

function inDays(days: number) {
  return days === 0 ? t('workdayWidget.today') : t('workdayWidget.days', { count: days })
}

const chips = computed(() => enabledExtras.value.flatMap((extra): { key: string; label: string; value: string }[] => {
  switch (extra) {
    case 'payday':
      return [{ key: extra, label: t('workdayWidget.extras.payday'), value: inDays(daysUntilPayday(now.value, props.payday)) }]
    case 'friday':
      return [{ key: extra, label: t('workdayWidget.extras.friday'), value: inDays(daysUntilFriday(now.value)) }]
    case 'holiday': {
      const festival = nextFestival(now.value)
      return festival ? [{ key: extra, label: festival.name, value: inDays(festival.days) }] : []
    }
    case 'income':
      return [{ key: extra, label: t('workdayWidget.extras.earned'), value: t('workdayWidget.money', { amount: state.value.earned.toFixed(2) }) }]
    default:
      return []
  }
}))
const visibleChips = computed(() => layout.value === 'large' ? chips.value : chips.value.slice(0, 2))

// Readable text on any background: pick dark or light text from the colour's luminance.
function isLightColor(color: string) {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i)?.[1]
  if (color === 'white')
    return true
  if (!hex || (hex.length !== 3 && hex.length !== 6 && hex.length !== 8))
    return false
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map(index => Number.parseInt(full.slice(index, index + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62
}

const surface = computed(() => {
  const style: Record<string, string> = {}
  const classes: string[] = [`is-${state.value.kind}`, `layout-${layout.value}`]
  if (props.backgroundImage) {
    classes.push('has-image')
    style['--wd-image'] = `url(${JSON.stringify(props.backgroundImage)})`
  }
  else if (props.background !== 'theme') {
    classes.push('has-color')
    style['--wd-background'] = props.background
  }
  if (props.textColor !== 'theme')
    style.color = props.textColor
  else if (!props.backgroundImage && props.background !== 'theme')
    style.color = isLightColor(props.background) ? '#1d1d1f' : 'white'
  if (props.font !== 'system')
    style.fontFamily = WORKDAY_FONT_STACKS[props.font]
  return { style, classes }
})

const clockParts = computed(() => {
  const total = state.value.seconds
  return [
    { key: 'hours', value: String(Math.floor(total / 3600)).padStart(2, '0'), label: t('workdayWidget.hours') },
    { key: 'minutes', value: String(Math.floor((total % 3600) / 60)).padStart(2, '0'), label: t('workdayWidget.minutes') },
    { key: 'seconds', value: String(total % 60).padStart(2, '0'), label: t('workdayWidget.seconds') },
  ]
})

// Monday-first week strip; days outside the configured workdays read as days off.
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
      isRest: !props.workdays.includes(String(isoWeekday(date))),
    }
  })
})
</script>

<template>
  <section v-if="expanded" class="workday-card workday-detail" :class="surface.classes" :style="surface.style" :aria-label="heading">
    <header class="wd-header">
      <span class="wd-mood" aria-hidden="true">{{ mood }}</span>
      <h3>{{ heading }}</h3>
      <span class="wd-hours">{{ startTime }} – {{ endTime }}</span>
    </header>
    <div class="wd-hero">
      <div v-if="counting" class="wd-digits" role="timer" :aria-label="clock">
        <template v-for="(part, index) in clockParts" :key="part.key">
          <span v-if="index" class="wd-colon" aria-hidden="true">:</span>
          <span class="wd-digit">
            <strong>{{ part.value }}</strong>
            <small>{{ part.label }}</small>
          </span>
        </template>
      </div>
      <strong v-else class="wd-message">{{ headline }}</strong>
      <span class="wd-caption">{{ caption }}</span>
      <div v-if="state.kind === 'working'" class="wd-progress" role="progressbar" :aria-valuenow="Math.round(state.progress * 100)" aria-valuemin="0" aria-valuemax="100">
        <i :style="{ width: `${state.progress * 100}%` }" />
      </div>
    </div>
    <ul v-if="chips.length" class="wd-chips">
      <li v-for="chip in chips" :key="chip.key">
        <span>{{ chip.label }}</span>
        <strong>{{ chip.value }}</strong>
      </li>
    </ul>
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
  <section v-else class="workday-card" :class="surface.classes" :style="surface.style" :aria-label="heading">
    <div class="workday-main">
      <span class="workday-label">{{ heading }}<template v-if="counting && (layout === 'large' || layout === 'strip')"> · {{ state.kind === 'before' ? t('workdayWidget.startsAt', { time: startTime }) : t('workdayWidget.offAt', { time: endTime }) }}</template></span>
      <strong :class="{ 'workday-timer': counting, 'workday-message': !counting }" :role="counting ? 'timer' : undefined">{{ headline }}</strong>
      <span v-if="layout === 'square' || !counting" class="workday-caption">{{ caption }}</span>
      <div v-if="state.kind === 'working' && layout !== 'mini'" class="workday-progress" aria-hidden="true">
        <i :style="{ width: `${state.progress * 100}%` }" />
      </div>
    </div>
    <span v-if="layout !== 'mini'" class="workday-mood" aria-hidden="true">{{ mood }}</span>
    <ul v-if="visibleChips.length && layout !== 'mini'" class="workday-chips">
      <li v-for="chip in visibleChips" :key="chip.key">
        <span>{{ chip.label }}</span>
        <strong>{{ chip.value }}</strong>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.workday-card { --wd-muted: color-mix(in srgb, currentColor 66%, transparent); --wd-chip: color-mix(in srgb, currentColor 13%, transparent); position: relative; display: grid; grid-template: "main mood" minmax(min-content, 1fr) "chips chips" minmax(0, auto) / minmax(0, 1fr) auto; gap: 8px 10px; width: 100%; height: 100%; min-height: 0; overflow: hidden; padding: 12px 16px; border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%)); border-radius: var(--pn-radius-large, 16px); color: var(--pn-widget-text-color, white); background: linear-gradient(135deg, color-mix(in srgb, var(--pn-color-accent, #10b981) 10%, transparent), transparent 54%), var(--pn-widget-background, rgb(18 25 39 / 42%)); box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%)); backdrop-filter: blur(var(--pn-effect-blur, 14px)); font-synthesis: none; container: workday / size; }
.workday-card.has-color { border-color: transparent; background: var(--wd-background); backdrop-filter: none; }
.workday-card.has-image { border-color: transparent; color: white; background: linear-gradient(180deg, rgb(0 0 0 / 8%), rgb(0 0 0 / 42%)), var(--wd-image) center / cover no-repeat; backdrop-filter: none; text-shadow: 0 1px 3px rgb(0 0 0 / 35%); }
.workday-main { grid-area: main; display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; }
/* Text never shrinks below its line box: a squeezed flex item with overflow: hidden clips the glyphs. Chips give way instead. */
.workday-main > * { flex-shrink: 0; }
.workday-label { overflow: hidden; max-width: 100%; color: var(--wd-muted); font-size: 12px; font-weight: 600; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.workday-main strong { max-width: 100%; font-variant-numeric: tabular-nums; font-size: clamp(22px, 11cqw, 40px); font-weight: 700; letter-spacing: -.02em; line-height: 1.1; white-space: nowrap; }
.workday-main strong.workday-message { overflow: hidden; line-height: 1.2; letter-spacing: normal; text-overflow: ellipsis; }
.workday-caption { color: var(--wd-muted); font-size: 12px; line-height: 16px; }
.workday-progress, .wd-progress { overflow: hidden; width: min(100%, 220px); height: 5px; margin-top: 4px; border-radius: 999px; background: var(--wd-chip); }
.workday-progress i, .wd-progress i { display: block; height: 100%; border-radius: inherit; background: currentColor; opacity: .85; }
.workday-mood { grid-area: mood; align-self: center; display: grid; width: clamp(44px, 17cqw, 68px); aspect-ratio: 1; place-items: center; border-radius: 50%; background: var(--wd-chip); font-size: clamp(24px, 10cqw, 42px); line-height: 1; text-shadow: none; }
.workday-chips { grid-area: chips; display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; max-height: 49px; margin: 0; padding: 0; overflow: hidden; list-style: none; }
.workday-chips li, .wd-chips li { display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; padding: 2px 8px; border-radius: 999px; background: var(--wd-chip); font-size: 12px; line-height: 18px; white-space: nowrap; }
.workday-chips span, .wd-chips span { color: var(--wd-muted); }
.workday-chips strong, .wd-chips strong { font-variant-numeric: tabular-nums; font-weight: 700; }

/* Square: the illustration sits above, chips fill two rows. */
.layout-square { grid-template: "main" minmax(min-content, 1fr) "chips" minmax(0, auto) / minmax(0, 1fr); gap: 6px; padding: 12px 14px; }
.layout-square .workday-mood { position: absolute; top: 10px; right: 10px; width: 32px; font-size: 18px; }
.layout-square .workday-main { justify-content: flex-end; }
.layout-square .workday-label { max-width: calc(100% - 36px); }
.layout-square .workday-main strong { font-size: clamp(20px, 15cqw, 30px); }
.layout-square .workday-caption { font-size: 11px; }
.layout-square .workday-chips { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.layout-square .workday-chips li { justify-content: center; overflow: hidden; padding: 3px 6px; font-size: 11px; }

/* One row: timer left, a couple of chips right. */
.layout-strip { grid-template: "mood main chips" minmax(0, 1fr) / auto minmax(0, 1fr) auto; align-items: center; padding: 8px 14px; }
.layout-strip .workday-mood { width: 40px; font-size: 22px; }
.layout-strip .workday-main { gap: 1px; }
.layout-strip .workday-main strong { font-size: clamp(18px, 7cqw, 28px); }
.layout-strip .workday-caption, .layout-strip .workday-progress, .layout-mini .workday-caption { display: none; }
.layout-strip .workday-chips { flex-direction: column; flex-wrap: nowrap; gap: 3px; }
.layout-strip .workday-chips li { padding: 2px 8px; font-size: 11px; }
.layout-mini { grid-template: "main" minmax(0, 1fr) / minmax(0, 1fr); padding: 8px 12px; }
.layout-mini .workday-main { align-items: center; text-align: center; gap: 1px; }
.layout-mini .workday-main strong { font-size: clamp(16px, 14cqw, 26px); }
@container (max-width: 290px) { .layout-strip .workday-chips { display: none; } }
/* Short wide cards drop the caption, then the second chip row, then the chips, so the headline never gets clipped. */
@container workday (max-height: 139px) { .layout-large .workday-caption { display: none; } }
@container workday (max-height: 119px) { .layout-large .workday-chips { max-height: 22px; } }
@container workday (max-height: 92px) { .layout-large .workday-chips { display: none; } }

.workday-detail { display: flex; flex-direction: column; justify-content: flex-start; gap: 18px; padding: 24px 30px; border-radius: 22px; }
.wd-header { display: flex; align-items: center; gap: 10px; }
.wd-header h3 { overflow: hidden; margin: 0; font-size: 18px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.wd-mood { display: grid; flex: none; width: 36px; height: 36px; place-items: center; border-radius: 50%; background: var(--wd-chip); font-size: 20px; text-shadow: none; }
.wd-hours { margin-left: auto; padding: 4px 12px; border-radius: 999px; background: var(--wd-chip); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wd-hero { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-height: 0; }
.wd-digits { display: flex; align-items: flex-start; gap: 10px; }
.wd-digit { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.wd-digit strong { display: grid; min-width: 1.35em; padding: 6px 14px; place-items: center; border-radius: 22px; background: var(--wd-chip); font-size: clamp(56px, 12cqw, 120px); font-weight: 300; line-height: 1.1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.wd-digit small { color: var(--wd-muted); font-size: 13px; font-weight: 600; }
.wd-colon { padding-top: .25em; color: var(--wd-muted); font-size: clamp(40px, 8cqw, 80px); font-weight: 200; line-height: 1; }
.wd-message { font-size: clamp(40px, 9cqw, 76px); font-weight: 700; }
.wd-caption { color: var(--wd-muted); font-size: 15px; }
.wd-progress { width: min(100%, 420px); height: 6px; margin: 0; }
.wd-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 0; padding: 0; list-style: none; }
.wd-chips li { padding: 7px 14px; font-size: 14px; }
.wd-week { padding-top: 16px; border-top: 1px solid var(--wd-chip); }
.wd-week-title { color: var(--wd-muted); font-size: 12px; font-weight: 600; }
.wd-week ol { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.wd-week li { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0; border-radius: 14px; background: var(--wd-chip); }
.wd-week li span { color: var(--wd-muted); font-size: 12px; }
.wd-week li strong { font-size: 18px; font-weight: 600; }
.wd-week li.is-past { opacity: .45; }
.wd-week li.is-rest strong { color: var(--wd-muted); }
.wd-week li.is-today { color: white; background: var(--pn-color-accent, #10b981); }
.wd-week li.is-today span { color: rgb(255 255 255 / 85%); }
@container (max-width: 560px) { .workday-detail { padding: 18px 16px; } .wd-digits { gap: 4px; } .wd-digit strong { padding: 4px 8px; border-radius: 14px; } .wd-week ol { gap: 4px; } }
</style>
