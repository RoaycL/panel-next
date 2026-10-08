<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NInputNumber, NSelect, NTimePicker } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { WorkdayExtra } from './workday'
import { WORKDAY_EXTRAS, WORKDAY_FONTS } from './workday'

const props = defineProps<{ modelValue: Record<string, unknown> }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: Record<string, unknown>): void }>()
const { t } = useI18n()

const BACKGROUNDS = ['theme', '#ffffff', '#ffd84d', '#ff6b5e', '#8d5a3b', '#2fb36e', '#1f2a5a', '#d9b99b', '#f6eedb', '#7a1f3d', '#e5484d', '#2f7cf6', '#9fe3c8', '#1b8a8a']
const TEXT_COLORS = ['theme', '#ffffff', '#1d1d1f', '#2f7cf6', '#8e5cf6', '#f25ca2', '#ef4444', '#f59e0b', '#6b7280', '#22a06b', '#7cc4fa']
const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7']

function value<T>(key: string, fallback: T): T {
  return (props.modelValue[key] ?? fallback) as T
}
function set(key: string, next: unknown) {
  emit('update:modelValue', { ...props.modelValue, [key]: next })
}

const workdays = computed(() => value('workdays', '12345'))
function toggleWeekday(day: string) {
  const next = workdays.value.includes(day) ? workdays.value.replace(day, '') : workdays.value + day
  set('workdays', next.split('').sort().join(''))
}

const backgroundMode = ref<'color' | 'image'>(value('backgroundImage', '') ? 'image' : 'color')
function chooseBackgroundMode(mode: 'color' | 'image') {
  backgroundMode.value = mode
  if (mode === 'color')
    set('backgroundImage', '')
}

const extras = computed(() => value('extras', '').split(',').filter(Boolean))
function toggleExtra(extra: WorkdayExtra) {
  const next = extras.value.includes(extra) ? extras.value.filter(item => item !== extra) : [...extras.value, extra]
  set('extras', WORKDAY_EXTRAS.filter(item => next.includes(item)).join(','))
}

const fontOptions = computed(() => WORKDAY_FONTS.map(font => ({ label: t(`workdayWidget.fonts.${font}`), value: font })))
const paydayOptions = computed(() => Array.from({ length: 31 }, (_, index) => ({ label: t('workdayWidget.settings.paydayOption', { day: index + 1 }), value: index + 1 })))
const customBackground = computed(() => {
  const current = value('background', 'theme')
  return BACKGROUNDS.includes(current) ? '#4f46e5' : current
})
const customText = computed(() => {
  const current = value('textColor', 'theme')
  return TEXT_COLORS.includes(current) ? '#4f46e5' : current
})
</script>

<template>
  <div class="workday-settings">
    <label class="ws-row">
      <span class="ws-label">{{ t('workdayWidget.settings.name') }}</span>
      <NInput :value="value('title', '')" :placeholder="t('workdayWidget.title')" :maxlength="40" @update:value="set('title', $event)" />
    </label>

    <div class="ws-row">
      <span class="ws-label">{{ t('workdayWidget.settings.workdays') }}</span>
      <div class="ws-inline">
        <div class="ws-weekdays" role="group" :aria-label="t('workdayWidget.settings.workdays')">
          <button v-for="day in WEEKDAYS" :key="day" type="button" class="ws-day" :class="{ 'is-on': workdays.includes(day) }" :aria-pressed="workdays.includes(day)" @click="toggleWeekday(day)">
            {{ t(`workdayWidget.settings.weekday${day}`) }}
          </button>
        </div>
        <NButton size="small" secondary @click="set('workdays', '12345')">
          {{ t('workdayWidget.settings.weekdaysPreset') }}
        </NButton>
        <NButton size="small" secondary @click="set('workdays', '1234567')">
          {{ t('workdayWidget.settings.everydayPreset') }}
        </NButton>
      </div>
    </div>

    <div class="ws-row">
      <span class="ws-label">{{ t('workdayWidget.settings.hours') }}</span>
      <div class="ws-inline">
        <NTimePicker class="ws-time" format="HH:mm" value-format="HH:mm" :formatted-value="value('startTime', '09:00')" :actions="null" @update:formatted-value="set('startTime', $event)" />
        <span class="ws-muted">{{ t('workdayWidget.settings.to') }}</span>
        <NTimePicker class="ws-time" format="HH:mm" value-format="HH:mm" :formatted-value="value('endTime', '18:00')" :actions="null" @update:formatted-value="set('endTime', $event)" />
      </div>
    </div>

    <div class="ws-row">
      <span class="ws-label">{{ t('workdayWidget.settings.background') }}</span>
      <div class="ws-stack">
        <div class="ws-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="backgroundMode === 'color'" :class="{ 'is-on': backgroundMode === 'color' }" @click="chooseBackgroundMode('color')">
            {{ t('workdayWidget.settings.color') }}
          </button>
          <button type="button" role="tab" :aria-selected="backgroundMode === 'image'" :class="{ 'is-on': backgroundMode === 'image' }" @click="chooseBackgroundMode('image')">
            {{ t('workdayWidget.settings.image') }}
          </button>
        </div>
        <div v-if="backgroundMode === 'color'" class="ws-swatches">
          <button
            v-for="color in BACKGROUNDS" :key="color" type="button" class="ws-swatch" :class="{ 'is-on': value('background', 'theme') === color, 'is-theme': color === 'theme' }"
            :style="color === 'theme' ? undefined : { background: color }" :title="color === 'theme' ? t('workdayWidget.settings.followTheme') : color" :aria-label="color === 'theme' ? t('workdayWidget.settings.followTheme') : color"
            @click="set('background', color)"
          />
          <label class="ws-swatch is-custom" :class="{ 'is-on': !BACKGROUNDS.includes(value('background', 'theme')) }" :title="t('workdayWidget.settings.custom')">
            <input type="color" :value="customBackground" :aria-label="t('workdayWidget.settings.custom')" @input="set('background', ($event.target as HTMLInputElement).value)">
          </label>
        </div>
        <NInput v-else :value="value('backgroundImage', '')" :placeholder="t('workdayWidget.settings.imagePlaceholder')" clearable @update:value="set('backgroundImage', ($event || '').trim())" />
      </div>
    </div>

    <div class="ws-row">
      <span class="ws-label">{{ t('workdayWidget.settings.textColor') }}</span>
      <div class="ws-swatches">
        <button
          v-for="color in TEXT_COLORS" :key="color" type="button" class="ws-swatch is-small" :class="{ 'is-on': value('textColor', 'theme') === color, 'is-theme': color === 'theme' }"
          :style="color === 'theme' ? undefined : { background: color }" :title="color === 'theme' ? t('workdayWidget.settings.auto') : color" :aria-label="color === 'theme' ? t('workdayWidget.settings.auto') : color"
          @click="set('textColor', color)"
        />
        <label class="ws-swatch is-small is-custom" :class="{ 'is-on': !TEXT_COLORS.includes(value('textColor', 'theme')) }" :title="t('workdayWidget.settings.custom')">
          <input type="color" :value="customText" :aria-label="t('workdayWidget.settings.custom')" @input="set('textColor', ($event.target as HTMLInputElement).value)">
        </label>
      </div>
    </div>

    <label class="ws-row">
      <span class="ws-label">{{ t('workdayWidget.settings.font') }}</span>
      <NSelect :value="value('font', 'system')" :options="fontOptions" @update:value="set('font', $event)" />
    </label>

    <div class="ws-row">
      <span class="ws-label">{{ t('workdayWidget.settings.more') }}</span>
      <div class="ws-extras">
        <button v-for="extra in WORKDAY_EXTRAS" :key="extra" type="button" class="ws-extra" :class="{ 'is-on': extras.includes(extra) }" :aria-pressed="extras.includes(extra)" @click="toggleExtra(extra)">
          {{ t(`workdayWidget.settings.extra.${extra}`) }}
        </button>
      </div>
    </div>

    <label v-if="extras.includes('payday')" class="ws-row">
      <span class="ws-label">{{ t('workdayWidget.settings.payday') }}</span>
      <NSelect :value="value('payday', 10)" :options="paydayOptions" @update:value="set('payday', $event)" />
    </label>

    <label v-if="extras.includes('income')" class="ws-row">
      <span class="ws-label">{{ t('workdayWidget.settings.income') }}</span>
      <NInputNumber :value="value('dailyIncome', 400)" :min="0" :max="1000000" :step="50" @update:value="set('dailyIncome', $event ?? 0)" />
    </label>
  </div>
</template>

<style scoped>
.workday-settings { display: grid; gap: 4px; }
.ws-row { display: grid; grid-template-columns: 92px minmax(0, 1fr); align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--pn-color-border, rgb(127 127 127 / 16%)); }
.ws-row:last-child { border-bottom: 0; }
.ws-label { font-size: 13px; font-weight: 700; }
.ws-muted { color: var(--pn-color-text-muted, #64748b); font-size: 13px; }
.ws-inline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ws-stack { display: grid; gap: 10px; }
.ws-time { width: 112px; }
.ws-weekdays { display: flex; gap: 4px; }
.ws-day, .ws-extra, .ws-tabs > button { border: 1px solid var(--pn-color-border, rgb(127 127 127 / 24%)); color: inherit; background: transparent; cursor: pointer; font: inherit; font-size: 13px; transition: background .15s ease, color .15s ease, border-color .15s ease; }
.ws-day { display: grid; width: 32px; height: 32px; padding: 0; place-items: center; border-radius: 50%; }
.ws-day.is-on, .ws-extra.is-on, .ws-tabs > button.is-on { border-color: var(--pn-color-accent, #10b981); color: white; background: var(--pn-color-accent, #10b981); }
.ws-tabs { display: inline-flex; justify-self: start; gap: 4px; padding: 3px; border-radius: 10px; background: color-mix(in srgb, var(--pn-color-text-muted, #64748b) 12%, transparent); }
.ws-tabs > button { padding: 4px 14px; border: 0; border-radius: 8px; }
.ws-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.ws-swatch { position: relative; width: 28px; height: 28px; padding: 0; border: 1px solid rgb(127 127 127 / 30%); border-radius: 50%; cursor: pointer; }
.ws-swatch.is-small { width: 24px; height: 24px; }
.ws-swatch.is-on { box-shadow: 0 0 0 2px var(--pn-color-surface, white), 0 0 0 4px var(--pn-color-accent, #10b981); }
.ws-swatch.is-theme { background: conic-gradient(from 45deg, rgb(127 127 127 / 45%) 0 25%, transparent 0 50%, rgb(127 127 127 / 45%) 0 75%, transparent 0) 0 0 / 10px 10px; }
.ws-swatch.is-custom { overflow: hidden; background: conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444); }
.ws-swatch.is-custom input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.ws-extras { display: flex; flex-wrap: wrap; gap: 6px; }
.ws-extra { padding: 4px 12px; border-radius: 999px; }
.ws-day:focus-visible, .ws-extra:focus-visible, .ws-swatch:focus-visible, .ws-swatch:focus-within, .ws-tabs > button:focus-visible { outline: 2px solid var(--pn-color-accent, #10b981); outline-offset: 2px; }
@media (max-width: 520px) { .ws-row { grid-template-columns: minmax(0, 1fr); gap: 6px; } }
</style>
