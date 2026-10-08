import type { TrendingSource } from '@/api/trending'
import type { WidgetConfigSchema, WidgetInstance } from './types'
import type { WorkdayFont } from './builtin/workday'
import { TRENDING_SOURCES } from '@/api/trending'
import { TIME_PATTERN, WORKDAYS_PATTERN, WORKDAY_FONTS } from './builtin/workday'
import * as field from './schema'
import { defineConfigSchema } from './schema'
import { defineWidget } from './define'
import { serializeWidgetLayout, widgetRegistry } from './registry'

// 序列化实现与出口兜底校验位于 ./registry（便于独立测试），此处保留稳定导出。
export { serializeWidgetLayout }
export type { WidgetLayout } from './types'

export interface ClockWidgetConfig {
  hideSecond: boolean
  showDate: boolean
}

export interface SearchWidgetConfig {
  background: string
  textColor: string
}

export interface WeatherWidgetConfig {
  city: string
  units: 'metric' | 'imperial'
}

export interface TrendingWidgetConfig {
  source: TrendingSource
  limit: number
}

export type CountdownRepeat = 'none' | 'yearly'

export interface CountdownWidgetConfig {
  title: string
  date: string
  repeat: CountdownRepeat
}

export interface NotesWidgetConfig {
  title: string
}

export interface WorkdayWidgetConfig {
  title: string
  /** ISO weekdays that are workdays, e.g. '12345' for Monday to Friday. */
  workdays: string
  startTime: string
  endTime: string
  /** 'theme' follows the dashboard widget style; otherwise a CSS colour. */
  background: string
  backgroundImage: string
  textColor: string
  font: WorkdayFont
  /** Comma-separated chips to show under the timer (see WORKDAY_EXTRAS). */
  extras: string
  payday: number
  dailyIncome: number
}

const clockSchema = defineConfigSchema<ClockWidgetConfig>({
  hideSecond: field.boolean(false),
  showDate: field.boolean(true),
})

const emptySchema: WidgetConfigSchema<Record<string, never>> = defineConfigSchema({})

const searchSchema = defineConfigSchema<SearchWidgetConfig>({
  background: field.color({ default: '#2a2a2a6b', max: 128, label: 'widgetLayout.fields.background' }),
  textColor: field.color({ default: 'white', max: 128, label: 'widgetLayout.fields.textColor' }),
})

const weatherSchema = defineConfigSchema<WeatherWidgetConfig>({
  city: field.string({ min: 2, max: 80, label: 'widgetLayout.fields.city' }),
  units: field.enumeration<'metric' | 'imperial'>({ values: ['metric', 'imperial'], default: 'metric', label: 'widgetLayout.fields.units' }),
})

const trendingSchema = defineConfigSchema<TrendingWidgetConfig>({
  source: field.enumeration<TrendingSource>({ values: TRENDING_SOURCES, default: 'weibo', label: 'widgetLayout.fields.source' }),
  limit: field.integer({ default: 10, min: 1, max: 50, label: 'widgetLayout.fields.limit' }),
})

// 日期格式约束 YYYY-MM-DD 由 field.isoDate 统一校验（见 ./schema.ts）
const countdownSchema = defineConfigSchema<CountdownWidgetConfig>({
  title: field.string({ min: 1, max: 40, label: 'widgetLayout.fields.title' }),
  date: field.isoDate({ label: 'widgetLayout.fields.date' }),
  repeat: field.enumeration<CountdownRepeat>({ values: ['none', 'yearly'], default: 'yearly', label: 'widgetLayout.fields.repeat' }),
})

const notesSchema = defineConfigSchema<NotesWidgetConfig>({
  title: field.string({ default: '', max: 40, label: 'widgetLayout.fields.title' }),
})

const workdaySchema = defineConfigSchema<WorkdayWidgetConfig>({
  title: field.string({ default: '', max: 40, label: 'widgetLayout.fields.title' }),
  workdays: field.string({ default: '12345', pattern: WORKDAYS_PATTERN }),
  startTime: field.string({ default: '09:00', pattern: TIME_PATTERN }),
  endTime: field.string({ default: '18:00', pattern: TIME_PATTERN, label: 'widgetLayout.fields.endTime', description: 'workdayWidget.timeHint' }),
  background: field.color({ default: 'theme', max: 32 }),
  backgroundImage: field.string({ default: '', max: 2000, pattern: /^(?:https?:\/\/\S+)?$/ }),
  textColor: field.color({ default: 'theme', max: 32 }),
  font: field.enumeration<WorkdayFont>({ values: WORKDAY_FONTS, default: 'system' }),
  extras: field.string({ default: 'payday,friday,holiday,income', max: 64, pattern: /^(?:(?:payday|friday|holiday|income)(?:,(?=[a-z])|$))*$/ }),
  payday: field.integer({ default: 10, min: 1, max: 31 }),
  dailyIncome: field.number({ default: 400, min: 0, max: 1000000 }),
})

export function defaultWorkdayConfig(): WorkdayWidgetConfig {
  return {
    title: '', workdays: '12345', startTime: '09:00', endTime: '18:00', background: 'theme', backgroundImage: '',
    textColor: 'theme', font: 'system', extras: 'payday,friday,holiday,income', payday: 10, dailyIncome: 400,
  }
}

if (!widgetRegistry.get('core.clock')) {
  widgetRegistry.register(defineWidget({
    type: 'core.clock', currentVersion: 1, configSchema: clockSchema,
    defaultConfig: () => ({ hideSecond: false, showDate: true }),
    size: { default: { columns: 2, rows: 1 }, min: { columns: 1, rows: 1 }, max: { columns: 4, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.clock' },
    load: () => import('./builtin/ClockWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.date', currentVersion: 1, configSchema: emptySchema, defaultConfig: () => ({}),
    size: { default: { columns: 2, rows: 1 }, min: { columns: 1, rows: 1 }, max: { columns: 4, rows: 1 } },
    meta: { title: 'widgetLayout.types.core.date' },
    load: () => import('./builtin/DateWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.search', currentVersion: 1, configSchema: searchSchema,
    defaultConfig: () => ({ background: '#2a2a2a6b', textColor: 'white' }),
    size: { default: { columns: 4, rows: 1 }, min: { columns: 2, rows: 1 }, max: { columns: 4, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.search' },
    load: () => import('./builtin/SearchWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.weather', currentVersion: 1, configSchema: weatherSchema,
    defaultConfig: () => ({ city: '北京', units: 'metric' }),
    size: { default: { columns: 4, rows: 2 }, min: { columns: 2, rows: 1 }, max: { columns: 4, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.weather' },
    capabilities: ['network'],
    load: () => import('./builtin/WeatherWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.trending', currentVersion: 1, configSchema: trendingSchema,
    defaultConfig: () => ({ source: 'weibo', limit: 10 }),
    size: { default: { columns: 4, rows: 2 }, min: { columns: 2, rows: 1 }, max: { columns: 4, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.trending' },
    capabilities: ['network'],
    load: () => import('./builtin/TrendingWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.countdown', currentVersion: 1, configSchema: countdownSchema,
    defaultConfig: () => ({ title: '元旦', date: '2027-01-01', repeat: 'yearly' }),
    size: { default: { columns: 3, rows: 2 }, min: { columns: 2, rows: 1 }, max: { columns: 4, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.countdown' },
    load: () => import('./builtin/CountdownWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.notes', currentVersion: 1, configSchema: notesSchema,
    defaultConfig: () => ({ title: '' }),
    size: { default: { columns: 4, rows: 2 }, min: { columns: 2, rows: 2 }, max: { columns: 4, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.notes' },
    capabilities: ['storage'],
    load: () => import('./builtin/NotesWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.calendar', currentVersion: 1, configSchema: emptySchema, defaultConfig: () => ({}),
    size: { default: { columns: 4, rows: 2 }, min: { columns: 2, rows: 2 }, max: { columns: 4, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.calendar' },
    load: () => import('./builtin/CalendarWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.todo', currentVersion: 1, configSchema: emptySchema, defaultConfig: () => ({}),
    size: { default: { columns: 4, rows: 2 }, min: { columns: 2, rows: 2 }, max: { columns: 4, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.todo' },
    capabilities: ['storage'],
    load: () => import('./builtin/TodoWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.workday', currentVersion: 2, configSchema: workdaySchema,
    defaultConfig: defaultWorkdayConfig,
    migrations: {
      // v1 only had "weekdays only"; keep each instance's title and end time.
      1: (config) => {
        const previous = (typeof config === 'object' && config !== null ? config : {}) as Record<string, unknown>
        const { weekdaysOnly, ...rest } = previous
        return { ...rest, workdays: weekdaysOnly === false ? '1234567' : '12345' }
      },
    },
    size: { default: { columns: 4, rows: 2 }, min: { columns: 2, rows: 1 }, max: { columns: 4, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.workday' },
    load: () => import('./builtin/WorkdayWidget.vue').then(module => module.default),
    settings: () => import('./builtin/WorkdaySettings.vue').then(module => module.default),
  }))
}

export function createHeaderClockWidget(hideSecond: boolean): WidgetInstance<ClockWidgetConfig> {
  return widgetRegistry.create('core.clock', 'header.clock', { column: 0, row: 0 }, { hideSecond, showDate: true })
}

export function createHeaderSearchWidget(): WidgetInstance<SearchWidgetConfig> {
  return widgetRegistry.create('core.search', 'header.search', { column: 0, row: 1 })
}

export function createHeaderWeatherWidget(): WidgetInstance<WeatherWidgetConfig> {
  return widgetRegistry.create('core.weather', 'header.weather', { column: 2, row: 0 })
}

export function createTrendingWidget(source: TrendingSource = 'weibo', limit = 10): WidgetInstance<TrendingWidgetConfig> {
  return widgetRegistry.create('core.trending', 'content.trending', { column: 0, row: 0 }, { source, limit })
}

export function createCountdownWidget(title: string, date: string, repeat: CountdownRepeat = 'none'): WidgetInstance<CountdownWidgetConfig> {
  return widgetRegistry.create('core.countdown', 'content.countdown', { column: 1, row: 0 }, { title, date, repeat })
}

/** 生成符合注册表 ID 规则的新组件实例 ID。 */
export function generateWidgetInstanceId(type: string): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
    ?? Math.random().toString(36).slice(2, 14)
  const suffix = `${Date.now().toString(36)}${random}`
  const id = `${type}.${suffix}`
  return id.length > 64 ? `${id.slice(0, 64 - suffix.length)}${suffix}` : id
}
