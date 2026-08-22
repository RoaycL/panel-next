import type { TrendingSource } from '@/api/trending'
import type { WidgetConfigSchema, WidgetInstance, WidgetLayout } from './types'
import { TRENDING_SOURCES } from '@/api/trending'
import * as field from './schema'
import { defineConfigSchema } from './schema'
import { defineWidget } from './define'
import { widgetRegistry } from './registry'
import { WIDGET_LAYOUT_SCHEMA_VERSION } from './types'

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

const clockSchema = defineConfigSchema<ClockWidgetConfig>({
  hideSecond: field.boolean(false),
  showDate: field.boolean(true),
})

const emptySchema: WidgetConfigSchema<Record<string, never>> = defineConfigSchema({})

const searchSchema = defineConfigSchema<SearchWidgetConfig>({
  background: field.string({ default: '#2a2a2a6b', max: 128 }),
  textColor: field.string({ default: 'white', max: 128 }),
})

const weatherSchema = defineConfigSchema<WeatherWidgetConfig>({
  city: field.string({ min: 2, max: 80 }),
  units: field.enumeration<'metric' | 'imperial'>({ values: ['metric', 'imperial'], default: 'metric' }),
})

const trendingSchema = defineConfigSchema<TrendingWidgetConfig>({
  source: field.enumeration<TrendingSource>({ values: TRENDING_SOURCES, default: 'weibo' }),
  limit: field.integer({ default: 10, min: 1, max: 50 }),
})

// 日期格式约束 YYYY-MM-DD 由 field.isoDate 统一校验（见 ./schema.ts）
const countdownSchema = defineConfigSchema<CountdownWidgetConfig>({
  title: field.string({ min: 1, max: 40 }),
  date: field.isoDate(),
  repeat: field.enumeration<CountdownRepeat>({ values: ['none', 'yearly'], default: 'yearly' }),
})

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
    size: { default: { columns: 6, rows: 1 }, min: { columns: 2, rows: 1 }, max: { columns: 12, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.search' },
    load: () => import('./builtin/SearchWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.weather', currentVersion: 1, configSchema: weatherSchema,
    defaultConfig: () => ({ city: '北京', units: 'metric' }),
    size: { default: { columns: 3, rows: 1 }, min: { columns: 2, rows: 1 }, max: { columns: 6, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.weather' },
    load: () => import('./builtin/WeatherWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.trending', currentVersion: 1, configSchema: trendingSchema,
    defaultConfig: () => ({ source: 'weibo', limit: 10 }),
    size: { default: { columns: 6, rows: 2 }, min: { columns: 3, rows: 1 }, max: { columns: 12, rows: 4 } },
    meta: { title: 'widgetLayout.types.core.trending' },
    capabilities: ['network'],
    load: () => import('./builtin/TrendingWidget.vue').then(module => module.default),
  })).register(defineWidget({
    type: 'core.countdown', currentVersion: 1, configSchema: countdownSchema,
    defaultConfig: () => ({ title: '元旦', date: '2027-01-01', repeat: 'yearly' }),
    size: { default: { columns: 3, rows: 2 }, min: { columns: 2, rows: 1 }, max: { columns: 6, rows: 2 } },
    meta: { title: 'widgetLayout.types.core.countdown' },
    load: () => import('./builtin/CountdownWidget.vue').then(module => module.default),
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

/** 将组件实例序列化为 v1 布局信封，按数组顺序写入稳定网格位置。 */
export function serializeWidgetLayout(instances: readonly WidgetInstance[]): WidgetLayout {
  return {
    schemaVersion: WIDGET_LAYOUT_SCHEMA_VERSION,
    widgets: instances.map((instance, index) => ({
      ...instance,
      position: { column: 0, row: index },
    })),
  }
}

/** 生成符合注册表 ID 规则的新组件实例 ID。 */
export function generateWidgetInstanceId(type: string): string {
  const suffix = Date.now().toString(36)
  const id = `${type}.${suffix}`
  return id.length > 64 ? `${id.slice(0, 64 - suffix.length)}${suffix}` : id
}
