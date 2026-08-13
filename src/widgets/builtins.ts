import type { WidgetConfigSchema, WidgetInstance } from './types'
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
