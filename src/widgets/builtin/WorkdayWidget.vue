<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  title?: string
  endTime?: string
  weekdaysOnly?: boolean
}>(), {
  title: '',
  endTime: '18:00',
  weekdaysOnly: true,
})

const { t } = useI18n()
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

const clock = computed(() => {
  const hours = Math.floor(state.value.seconds / 3600)
  const minutes = Math.floor((state.value.seconds % 3600) / 60)
  const seconds = state.value.seconds % 60
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
})
</script>

<template>
  <section class="workday-card" :aria-label="heading">
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
.workday-card { display: flex; flex-direction: column; justify-content: center; gap: 12px; width: 100%; height: 100%; min-height: 0; overflow: hidden; padding: 14px 18px; border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%)); border-radius: var(--pn-radius-large, 16px); color: var(--pn-widget-text-color, white); background: linear-gradient(135deg, color-mix(in srgb, var(--pn-color-accent, #10b981) 10%, transparent), transparent 54%), var(--pn-widget-background, rgb(18 25 39 / 42%)); box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%)); backdrop-filter: blur(var(--pn-effect-blur, 14px)); }
.workday-card header { display: flex; align-items: center; gap: 9px; }
.workday-icon { display: grid; flex: none; width: 28px; height: 28px; place-items: center; border-radius: 9px; color: var(--pn-color-accent, #10b981); background: color-mix(in srgb, var(--pn-color-accent, #10b981) 13%, transparent); font-size: 16px; }
.workday-card h3 { overflow: hidden; margin: 0; font-size: 13px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.workday-main { display: flex; flex-direction: column; gap: 5px; padding-left: 1px; }
.workday-main strong { font-variant-numeric: tabular-nums; font-size: clamp(24px, 4cqw, 38px); font-weight: 800; letter-spacing: -.04em; line-height: 1.1; }
.workday-main strong.workday-message { font-size: clamp(19px, 3cqw, 30px); }
.workday-main span { color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 11px; }
</style>
