import type {
  WidgetDefinition,
  WidgetInstance,
  WidgetLayoutLoadResult,
  WidgetPosition,
  WidgetSize,
} from './types'
import { WIDGET_ID_PATTERN, WIDGET_TYPE_PATTERN } from './constants'
import { WIDGET_LAYOUT_SCHEMA_VERSION } from './types'

const MAX_GRID_VALUE = 10000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGridInteger(value: unknown, minimum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= MAX_GRID_VALUE
}

function parsePosition(value: unknown): WidgetPosition {
  if (!isRecord(value) || !isGridInteger(value.column, 0) || !isGridInteger(value.row, 0))
    throw new Error('Invalid widget position.')
  return { column: Number(value.column), row: Number(value.row) }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function parseSize(value: unknown, definition: WidgetDefinition): WidgetSize {
  if (!isRecord(value) || !isGridInteger(value.columns, 1) || !isGridInteger(value.rows, 1))
    throw new Error('Invalid widget size.')
  return {
    columns: clamp(Number(value.columns), definition.size.min.columns, definition.size.max.columns),
    rows: clamp(Number(value.rows), definition.size.min.rows, definition.size.max.rows),
  }
}

function validateDefinition(definition: WidgetDefinition) {
  if (!WIDGET_TYPE_PATTERN.test(definition.type) || !Number.isSafeInteger(definition.currentVersion) || definition.currentVersion < 1)
    throw new Error('Invalid widget definition identity.')
  if (definition.meta && (typeof definition.meta.title !== 'string' || !definition.meta.title.trim()))
    throw new Error(`Widget ${definition.type} declared an invalid meta.title.`)
  for (const axis of ['columns', 'rows'] as const) {
    const minimum = definition.size.min[axis]
    const initial = definition.size.default[axis]
    const maximum = definition.size.max[axis]
    if (!isGridInteger(minimum, 1) || !isGridInteger(initial, 1) || !isGridInteger(maximum, 1)
      || minimum > initial || initial > maximum) {
      throw new Error(`Invalid widget ${axis} constraints.`)
    }
  }
}

export class WidgetRegistry {
  private readonly definitions = new Map<string, WidgetDefinition>()

  register<TConfig>(definition: WidgetDefinition<TConfig>) {
    validateDefinition(definition)
    if (this.definitions.has(definition.type))
      throw new Error(`Widget type already registered: ${definition.type}`)
    this.definitions.set(definition.type, definition as WidgetDefinition)
    return this
  }

  get(type: string) {
    return this.definitions.get(type) ?? null
  }

  list() {
    return [...this.definitions.values()]
  }

  create<TConfig>(type: string, id: string, position: WidgetPosition, config?: unknown): WidgetInstance<TConfig> {
    const definition = this.definitions.get(type)
    if (!definition || !WIDGET_ID_PATTERN.test(id))
      throw new Error('Unknown widget type or invalid widget id.')
    return {
      id,
      type,
      version: definition.currentVersion,
      position: parsePosition(position),
      size: { ...definition.size.default },
      hidden: false,
      config: definition.configSchema.parse(config ?? definition.defaultConfig()) as TConfig,
    }
  }

  migrate(value: unknown): WidgetInstance {
    if (!isRecord(value) || typeof value.id !== 'string' || !WIDGET_ID_PATTERN.test(value.id)
      || typeof value.type !== 'string') {
      throw new Error('Invalid widget instance identity.')
    }
    const definition = this.definitions.get(value.type)
    if (!definition || !Number.isSafeInteger(value.version) || Number(value.version) < 1
      || Number(value.version) > definition.currentVersion) {
      throw new Error('Unknown widget type or unsupported widget version.')
    }
    let version = Number(value.version)
    let config: unknown = value.config
    while (version < definition.currentVersion) {
      const migration = definition.migrations?.[version]
      if (!migration)
        throw new Error(`Missing migration for ${definition.type} version ${version}.`)
      config = migration(config)
      version++
    }
    return {
      id: value.id,
      type: value.type,
      version,
      position: parsePosition(value.position),
      size: parseSize(value.size, definition),
      hidden: value.hidden === true,
      config: definition.configSchema.parse(config),
    }
  }

  loadLayout(value: unknown): WidgetLayoutLoadResult {
    if (!isRecord(value) || value.schemaVersion !== WIDGET_LAYOUT_SCHEMA_VERSION || !Array.isArray(value.widgets))
      throw new Error('Unsupported widget layout schema.')
    const widgets: WidgetInstance[] = []
    const droppedWidgetIds: string[] = []
    const ids = new Set<string>()
    for (const candidate of value.widgets) {
      try {
        const widget = this.migrate(candidate)
        if (ids.has(widget.id))
          throw new Error('Duplicate widget id.')
        ids.add(widget.id)
        widgets.push(widget)
      }
      catch {
        droppedWidgetIds.push(isRecord(candidate) && typeof candidate.id === 'string' ? candidate.id : '<unknown>')
      }
    }
    return { layout: { schemaVersion: WIDGET_LAYOUT_SCHEMA_VERSION, widgets }, droppedWidgetIds }
  }
}

export const widgetRegistry = new WidgetRegistry()
