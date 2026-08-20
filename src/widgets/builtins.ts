import type { TrendingSource } from '@/api/trending'
import type { WidgetConfigSchema, WidgetInstance } from './types'
import { TRENDING_SOURCES } from '@/api/trending'
import { widgetRegistry } from './registry'

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

const clockSchema: WidgetConfigSchema<ClockWidgetConfig> = {
  parse(value) {
    if (typeof value !== 'object' || value === null)
      throw new Error('Invalid clock widget config.')
    const config = value as Partial<ClockWidgetConfig>
    if (typeof config.hideSecond !== 'boolean' || typeof config.showDate !== 'boolean')
      throw new Error('Invalid clock widget config.')
    return { hideSecond: config.hideSecond, showDate: config.showDate }
  },
}

const emptySchema: WidgetConfigSchema<Record<string, never>> = {
  parse(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length)
      throw new Error('Invalid date widget config.')
    return {}
  },
}

const searchSchema: WidgetConfigSchema<SearchWidgetConfig> = {
  parse(value) {
    if (typeof value !== 'object' || value === null)
      throw new Error('Invalid search widget config.')
    const config = value as Partial<SearchWidgetConfig>
    if (typeof config.background !== 'string' || typeof config.textColor !== 'string'
      || config.background.length > 128 || config.textColor.length > 128) {
      throw new Error('Invalid search widget config.')
    }
    return { background: config.background, textColor: config.textColor }
  },
}

const weatherSchema: WidgetConfigSchema<WeatherWidgetConfig> = {
  parse(value) {
    if (typeof value !== 'object' || value === null)
      throw new Error('Invalid weather widget config.')
    const config = value as Partial<WeatherWidgetConfig>
    const city = typeof config.city === 'string' ? config.city.trim() : ''
    if (city.length < 2 || city.length > 80 || (config.units !== 'metric' && config.units !== 'imperial'))
      throw new Error('Invalid weather widget config.')
    return { city, units: config.units }
  },
}

const trendingSchema: WidgetConfigSchema<TrendingWidgetConfig> = {
  parse(value) {
    if (typeof value !== 'object' || value === null)
      throw new Error('Invalid trending widget config.')
    const config = value as Partial<TrendingWidgetConfig>
    if (!TRENDING_SOURCES.includes(config.source as TrendingSource))
      throw new Error('Invalid trending widget config.')
    const limit = Number(config.limit ?? 10)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error('Invalid trending widget config.')
    return { source: config.source as TrendingSource, limit }
  },
}

const countdownSchema: WidgetConfigSchema<CountdownWidgetConfig> = {
  parse(value) {
    if (typeof value !== 'object' || value === null)
      throw new Error('Invalid countdown widget config.')
    const config = value as Partial<CountdownWidgetConfig>
    const title = typeof config.title === 'string' ? config.title.trim() : ''
    if (!title || title.length > 40)
      throw new Error('Invalid countdown widget config.')
    if (typeof config.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(config.date))
      throw new Error('Invalid countdown widget config.')
    const [year, month, day] = config.date.split('-').map(Number)
    const probe = new Date(year, month - 1, day)
    if (year < 1900 || probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day)
      throw new Error('Invalid countdown widget config.')
    if (config.repeat !== 'none' && config.repeat !== 'yearly')
      throw new Error('Invalid countdown widget config.')
    return { title, date: config.date, repeat: config.repeat }
  },
}

if (!widgetRegistry.get('core.clock')) {
  widgetRegistry.register({
    type: 'core.clock', currentVersion: 1, configSchema: clockSchema,
    defaultConfig: () => ({ hideSecond: false, showDate: true }),
    size: { default: { columns: 2, rows: 1 }, min: { columns: 1, rows: 1 }, max: { columns: 4, rows: 2 } },
    load: () => import('./builtin/ClockWidget.vue').then(module => module.default),
  }).register({
    type: 'core.date', currentVersion: 1, configSchema: emptySchema, defaultConfig: () => ({}),
    size: { default: { columns: 2, rows: 1 }, min: { columns: 1, rows: 1 }, max: { columns: 4, rows: 1 } },
    load: () => import('./builtin/DateWidget.vue').then(module => module.default),
  }).register({
    type: 'core.search', currentVersion: 1, configSchema: searchSchema,
    defaultConfig: () => ({ background: '#2a2a2a6b', textColor: 'white' }),
    size: { default: { columns: 6, rows: 1 }, min: { columns: 2, rows: 1 }, max: { columns: 12, rows: 2 } },
    load: () => import('./builtin/SearchWidget.vue').then(module => module.default),
  }).register({
    type: 'core.weather', currentVersion: 1, configSchema: weatherSchema,
    defaultConfig: () => ({ city: '北京', units: 'metric' }),
    size: { default: { columns: 3, rows: 1 }, min: { columns: 2, rows: 1 }, max: { columns: 6, rows: 2 } },
    load: () => import('./builtin/WeatherWidget.vue').then(module => module.default),
  }).register({
    type: 'core.trending', currentVersion: 1, configSchema: trendingSchema,
    defaultConfig: () => ({ source: 'weibo', limit: 10 }),
    size: { default: { columns: 4, rows: 2 }, min: { columns: 2, rows: 1 }, max: { columns: 8, rows: 4 } },
    load: () => import('./builtin/TrendingWidget.vue').then(module => module.default),
  }).register({
    type: 'core.countdown', currentVersion: 1, configSchema: countdownSchema,
    defaultConfig: () => ({ title: '元旦', date: '2027-01-01', repeat: 'yearly' }),
    size: { default: { columns: 2, rows: 1 }, min: { columns: 2, rows: 1 }, max: { columns: 4, rows: 2 } },
    load: () => import('./builtin/CountdownWidget.vue').then(module => module.default),
  })
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
