import type {
  WidgetDefinition,
  WidgetInstance,
  WidgetLayout,
  WidgetLayoutLoadResult,
  WidgetPosition,
  WidgetSize,
  WidgetStackMembership,
} from './types'
import { WIDGET_ID_PATTERN, WIDGET_TYPE_PATTERN } from './constants'
import { MAX_WIDGET_CONFIG_BYTES, MAX_WIDGET_INSTANCES, MAX_WIDGET_LAYOUT_BYTES, MAX_WIDGET_STACK_SIZE, WIDGET_LAYOUT_SCHEMA_VERSION } from './types'
import { normalizeWidgetPositions, normalizeWidgetStacks } from './stack'

const MAX_GRID_VALUE = 10000
export const MAX_WIDGET_GRID_COLUMNS = 12
export const MAX_WIDGET_GRID_ROWS = 24
const VALID_CAPABILITIES = new Set(['network', 'storage', 'clipboard', 'geolocation'])
const VALID_SURFACES = new Set(['web', 'extension'])

/**
 * 与后端 Go json.Marshal 的字节口径保持一致：
 * - <、>、&、U+2028、U+2029 会被转义为 \uXXXX（6 字节）；
 * - Go 不短转义 \b 与 \f（JS 为 2 字节，Go 为 \u0008/\u000c 共 6 字节）；
 * - 孤立代理对在 JSON.stringify 中同样输出为 6 字节转义。
 * 直接统计原始字符串并累加差值，避免构造巨型转义副本。
 */
const GO_ESCAPED_SIX_BYTES = new Set(['<', '>', '&', '\u2028', '\u2029'])

function jsonSize(value: unknown) {
  try {
    const raw = JSON.stringify(value)
    if (typeof raw !== 'string')
      return Number.POSITIVE_INFINITY
    let bytes = 0
    for (const character of raw) {
      const codePoint = character.codePointAt(0) ?? 0
      if (GO_ESCAPED_SIX_BYTES.has(character) || (codePoint >= 0xD800 && codePoint <= 0xDFFF) || codePoint === 0x08 || codePoint === 0x0C)
        bytes += 6
      else if (codePoint < 0x80)
        bytes += 1
      else if (codePoint < 0x800)
        bytes += 2
      else if (codePoint < 0x10000)
        bytes += 3
      else
        bytes += 4
    }
    return bytes
  }
  catch {
    return Number.POSITIVE_INFINITY
  }
}

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

function parseStack(value: unknown): WidgetStackMembership | undefined {
  if (value === undefined)
    return undefined
  if (!isRecord(value) || typeof value.id !== 'string' || !WIDGET_ID_PATTERN.test(value.id)
    || !Number.isSafeInteger(value.order) || Number(value.order) < 0 || Number(value.order) >= MAX_WIDGET_STACK_SIZE) {
    throw new Error('Invalid widget stack membership.')
  }
  return { id: value.id, order: Number(value.order) }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function sameSize(a: WidgetSize, b: WidgetSize) {
  return a.columns === b.columns && a.rows === b.rows
}

function resolveSizeForDefinition(
  definition: WidgetDefinition,
  requested: WidgetSize,
  supportedSizes = definition.size.supportedSizes,
): WidgetSize {
  const columns = clamp(Math.round(requested.columns), definition.size.min.columns, definition.size.max.columns)
  const rows = clamp(Math.round(requested.rows), definition.size.min.rows, definition.size.max.rows)
  if (supportedSizes?.length) {
    const nearest = supportedSizes.reduce((current, candidate) => {
      const candidateDistance = Math.abs(candidate.columns - columns) + Math.abs(candidate.rows - rows)
      const nearestDistance = Math.abs(current.columns - columns) + Math.abs(current.rows - rows)
      return candidateDistance < nearestDistance ? candidate : current
    }, supportedSizes[0])
    return { ...nearest }
  }
  const step = definition.size.step ?? { columns: 1, rows: 1 }
  return {
    columns: clamp(
      definition.size.min.columns + Math.round((columns - definition.size.min.columns) / step.columns) * step.columns,
      definition.size.min.columns,
      definition.size.max.columns,
    ),
    rows: clamp(
      definition.size.min.rows + Math.round((rows - definition.size.min.rows) / step.rows) * step.rows,
      definition.size.min.rows,
      definition.size.max.rows,
    ),
  }
}

function parseSize(value: unknown, definition: WidgetDefinition): WidgetSize {
  if (!isRecord(value) || !isGridInteger(value.columns, 1) || !isGridInteger(value.rows, 1))
    throw new Error('Invalid widget size.')
  return resolveSizeForDefinition(definition, { columns: Number(value.columns), rows: Number(value.rows) })
}

function validateDefinition(definition: WidgetDefinition) {
  if (!WIDGET_TYPE_PATTERN.test(definition.type) || !Number.isSafeInteger(definition.currentVersion) || definition.currentVersion < 1)
    throw new Error('Invalid widget definition identity.')
  if (definition.meta && (typeof definition.meta.title !== 'string' || !definition.meta.title.trim()))
    throw new Error(`Widget ${definition.type} declared an invalid meta.title.`)
  if (typeof definition.defaultConfig !== 'function' || typeof definition.configSchema?.parse !== 'function' || typeof definition.load !== 'function')
    throw new Error(`Widget ${definition.type} declared an incomplete contract.`)
  if (definition.capabilities && (new Set(definition.capabilities).size !== definition.capabilities.length
    || definition.capabilities.some(capability => !VALID_CAPABILITIES.has(capability))))
    throw new Error(`Widget ${definition.type} declared invalid capabilities.`)
  if (definition.surfaces && (!definition.surfaces.length || new Set(definition.surfaces).size !== definition.surfaces.length
    || definition.surfaces.some(surface => !VALID_SURFACES.has(surface))))
    throw new Error(`Widget ${definition.type} declared invalid surfaces.`)
  for (const axis of ['columns', 'rows'] as const) {
    const minimum = definition.size.min[axis]
    const initial = definition.size.default[axis]
    const maximum = definition.size.max[axis]
    if (!isGridInteger(minimum, 1) || !isGridInteger(initial, 1) || !isGridInteger(maximum, 1)
      || minimum > initial || initial > maximum) {
      throw new Error(`Invalid widget ${axis} constraints.`)
    }
    if ((axis === 'columns' && maximum > MAX_WIDGET_GRID_COLUMNS) || (axis === 'rows' && maximum > MAX_WIDGET_GRID_ROWS))
      throw new Error(`Widget ${definition.type} exceeds the host grid limits.`)
  }
  const step = definition.size.step ?? { columns: 1, rows: 1 }
  if (!isGridInteger(step.columns, 1) || !isGridInteger(step.rows, 1))
    throw new Error(`Widget ${definition.type} declared invalid resize steps.`)
  if (!definition.size.supportedSizes) {
    for (const axis of ['columns', 'rows'] as const) {
      if ((definition.size.default[axis] - definition.size.min[axis]) % step[axis] !== 0
        || (definition.size.max[axis] - definition.size.min[axis]) % step[axis] !== 0) {
        throw new Error(`Widget ${definition.type} size range is not aligned to its resize steps.`)
      }
    }
  }
  if (definition.size.resize && !['both', 'horizontal', 'vertical', 'none'].includes(definition.size.resize))
    throw new Error(`Widget ${definition.type} declared an invalid resize mode.`)
  if (definition.size.supportedSizes) {
    if (!definition.size.supportedSizes.length)
      throw new Error(`Widget ${definition.type} declared an empty supportedSizes list.`)
    const keys = new Set<string>()
    for (const size of definition.size.supportedSizes) {
      if (!isGridInteger(size.columns, 1) || !isGridInteger(size.rows, 1)
        || size.columns < definition.size.min.columns || size.columns > definition.size.max.columns
        || size.rows < definition.size.min.rows || size.rows > definition.size.max.rows) {
        throw new Error(`Widget ${definition.type} declared an invalid supported size.`)
      }
      const key = `${size.columns}x${size.rows}`
      if (keys.has(key))
        throw new Error(`Widget ${definition.type} declared duplicate supported sizes.`)
      keys.add(key)
    }
    if (!definition.size.supportedSizes.some(size => sameSize(size, definition.size.default)))
      throw new Error(`Widget ${definition.type} default size is not supported.`)
  }
  const defaults = definition.configSchema.parse(definition.defaultConfig())
  if (jsonSize(defaults) > MAX_WIDGET_CONFIG_BYTES)
    throw new Error(`Widget ${definition.type} default config is too large.`)
}

/**
 * 统一传输结构契约（与后端 service/api/api_v1/panel/widgetLayoutValidation.go 完全一致）。
 *
 * 该校验与组件注册表无关：即使 type 未注册、version 超前，只要满足服务端结构约束，
 * 就属于「可安全持久化」的数据。返回 null 表示通过，否则返回可读的违规原因。
 *
 * 双端一致性由 scripts/fixtures/widget-wire-samples.json 共享样本测试保证
 * （TS: scripts/validate-widget-registry.mjs；Go: widgetLayoutValidation_test.go）。
 */
export function validateWidgetWireInstance(candidate: unknown): string | null {
  if (!isRecord(candidate))
    return 'widget must be an object'
  if (typeof candidate.id !== 'string' || !WIDGET_ID_PATTERN.test(candidate.id))
    return 'invalid widget id'
  if (typeof candidate.type !== 'string' || !WIDGET_TYPE_PATTERN.test(candidate.type))
    return 'invalid widget type'
  if (!Number.isSafeInteger(candidate.version) || (candidate.version as number) < 1)
    return 'invalid widget version'
  if (!isRecord(candidate.position)
    || !Number.isSafeInteger(candidate.position.column) || (candidate.position.column as number) < 0
    || (candidate.position.column as number) > MAX_GRID_VALUE
    || !Number.isSafeInteger(candidate.position.row) || (candidate.position.row as number) < 0
    || (candidate.position.row as number) > MAX_GRID_VALUE)
    return 'invalid widget position'
  if (!isRecord(candidate.size)
    || !Number.isSafeInteger(candidate.size.columns) || (candidate.size.columns as number) < 1
    || (candidate.size.columns as number) > MAX_WIDGET_GRID_COLUMNS
    || !Number.isSafeInteger(candidate.size.rows) || (candidate.size.rows as number) < 1
    || (candidate.size.rows as number) > MAX_WIDGET_GRID_ROWS)
    return 'invalid widget size'
  if (candidate.hidden !== undefined && typeof candidate.hidden !== 'boolean')
    return 'invalid hidden flag'
  try {
    parseStack(candidate.stack)
  }
  catch {
    return 'invalid widget stack membership'
  }
  if (jsonSize(candidate.config ?? null) > MAX_WIDGET_CONFIG_BYTES)
    return 'widget config exceeds the size limit'
  return null
}

function assertParsedConfigSize(type: string, config: unknown) {
  if (jsonSize(config) > MAX_WIDGET_CONFIG_BYTES)
    throw new Error(`Widget ${type} produced a config beyond the ${MAX_WIDGET_CONFIG_BYTES}-byte transport limit.`)
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
    const parsedConfig = definition.configSchema.parse(config ?? definition.defaultConfig()) as TConfig
    assertParsedConfigSize(type, parsedConfig)
    return {
      id,
      type,
      version: definition.currentVersion,
      position: parsePosition(position),
      size: { ...definition.size.default },
      hidden: false,
      config: parsedConfig,
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
    const parsedConfig = definition.configSchema.parse(config)
    assertParsedConfigSize(definition.type, parsedConfig)
    return {
      id: value.id,
      type: value.type,
      version,
      position: parsePosition(value.position),
      size: parseSize(value.size, definition),
      hidden: value.hidden === true,
      stack: parseStack(value.stack),
      config: parsedConfig,
    }
  }

  loadLayout(value: unknown): WidgetLayoutLoadResult {
    if (!isRecord(value) || value.schemaVersion !== WIDGET_LAYOUT_SCHEMA_VERSION || !Array.isArray(value.widgets))
      throw new Error('Unsupported widget layout schema.')
    if (value.widgets.length > MAX_WIDGET_INSTANCES || jsonSize(value) > MAX_WIDGET_LAYOUT_BYTES)
      throw new Error('Widget layout exceeds the host limits.')
    const widgets: WidgetInstance[] = []
    const droppedWidgetIds: string[] = []
    const quarantinedWidgets: unknown[] = []
    const issues: WidgetLayoutLoadResult['issues'] = []
    const ids = new Set<string>()
    const seenIds = new Set<string>()
    for (const candidate of value.widgets) {
      const candidateId = isRecord(candidate) && typeof candidate.id === 'string' ? candidate.id : null
      const duplicateCandidate = candidateId !== null && seenIds.has(candidateId)
      if (candidateId !== null)
        seenIds.add(candidateId)
      try {
        if (duplicateCandidate)
          throw new Error('Duplicate widget id.')
        const widget = this.migrate(candidate)
        if (ids.has(widget.id))
          throw new Error('Duplicate widget id.')
        ids.add(widget.id)
        widgets.push(widget)
      }
      catch (error) {
        const id = isRecord(candidate) && typeof candidate.id === 'string' ? candidate.id : '<unknown>'
        // 入口闸：只有同时满足服务端传输契约的条目才允许进入隔离区，
        // 否则会在下一次保存时被后端整体拒绝（见 validateWidgetWireInstance）。
        const preservable = !duplicateCandidate && candidateId !== null && !ids.has(candidateId)
          && validateWidgetWireInstance(candidate) === null
        if (preservable)
          quarantinedWidgets.push(JSON.parse(JSON.stringify(candidate)))
        else
          droppedWidgetIds.push(id)
        issues.push({ id, reason: error instanceof Error ? error.message : 'Invalid widget instance.', preserved: preservable })
      }
    }
    if (normalizeWidgetStacks(widgets))
      issues.push({ id: '<stack>', reason: 'Invalid or incomplete widget stack was repaired.', preserved: false })
    return { layout: { schemaVersion: WIDGET_LAYOUT_SCHEMA_VERSION, widgets }, droppedWidgetIds, quarantinedWidgets, issues }
  }
}

/**
 * 序列化出口兜底：
 * - 正常实例违反传输契约 → 抛错阻断保存（静默丢弃用户正在使用的组件不可接受）；
 * - 隔离实例违反契约 → 丢弃并告警（本就无法渲染，保住它们反而会卡死整次保存）；
 * - 输出始终满足后端 validatePanelWidgetLayout 的全部结构约束。
 */
export function serializeWidgetLayout(
  instances: readonly WidgetInstance[],
  quarantinedWidgets: readonly unknown[] = [],
): WidgetLayout {
  const seenIds = new Set<string>()
  for (const instance of instances) {
    const violation = validateWidgetWireInstance(instance)
    if (violation)
      throw new Error(`Widget "${instance.id}" (${instance.type}) cannot be saved: ${violation}.`)
    // 正常实例重复 ID：调用方缺陷，抛错阻断保存
    if (seenIds.has(instance.id))
      throw new Error(`Duplicate widget id "${instance.id}" cannot be saved.`)
    seenIds.add(instance.id)
  }
  const preservedQuarantine: unknown[] = []
  for (const candidate of quarantinedWidgets) {
    const candidateId = isRecord(candidate) && typeof candidate.id === 'string' ? candidate.id : null
    const violation = validateWidgetWireInstance(candidate)
    if (violation || candidateId === null || seenIds.has(candidateId)) {
      console.warn('Dropped a quarantined widget that violates the server wire contract or collides with an existing id.', candidate)
      continue
    }
    preservedQuarantine.push(candidate)
    seenIds.add(candidateId)
  }
  const normalizedInstances = instances.map(instance => ({
    ...instance,
    position: { ...instance.position },
    size: { ...instance.size },
    stack: instance.stack ? { ...instance.stack } : undefined,
  }))
  normalizeWidgetStacks(normalizedInstances)
  const widgets = [
    ...normalizeWidgetPositions(normalizedInstances),
    ...preservedQuarantine,
  ]
  if (widgets.length > MAX_WIDGET_INSTANCES)
    throw new Error('Widget layout contains too many instances.')
  const layout: WidgetLayout = {
    schemaVersion: WIDGET_LAYOUT_SCHEMA_VERSION,
    widgets: widgets as WidgetInstance[],
  }
  if (jsonSize(layout) > MAX_WIDGET_LAYOUT_BYTES)
    throw new Error('Widget layout is too large.')
  return layout
}

export const widgetRegistry = new WidgetRegistry()

export function resolveWidgetSize(type: string, requested: WidgetSize): WidgetSize | null {
  const definition = widgetRegistry.get(type)
  if (!definition || !Number.isFinite(requested.columns) || !Number.isFinite(requested.rows))
    return null
  return { ...resolveSizeForDefinition(definition, requested) }
}

export function canResizeWidgetAxis(type: string, axis: 'columns' | 'rows'): boolean {
  const mode = widgetRegistry.get(type)?.size.resize ?? 'both'
  return mode === 'both' || (mode === 'horizontal' && axis === 'columns') || (mode === 'vertical' && axis === 'rows')
}

export function resizeInstanceToWithinBounds(instance: WidgetInstance, requested: WidgetSize): boolean {
  const definition = widgetRegistry.get(instance.type)
  if (!definition)
    return false
  const allowsColumns = canResizeWidgetAxis(instance.type, 'columns')
  const allowsRows = canResizeWidgetAxis(instance.type, 'rows')
  const constrained = {
    columns: allowsColumns ? requested.columns : instance.size.columns,
    rows: allowsRows ? requested.rows : instance.size.rows,
  }
  const supported = definition.size.supportedSizes?.filter(size => (allowsColumns || size.columns === instance.size.columns)
    && (allowsRows || size.rows === instance.size.rows))
  if (definition.size.supportedSizes && !supported?.length)
    return false
  const resolved = resolveSizeForDefinition(definition, constrained, supported)
  if (!resolved || sameSize(resolved, instance.size))
    return false
  instance.size = resolved
  return true
}

/** 在注册表尺寸约束内尝试缩放实例；返回是否发生了变化（宿主编辑器通用）。 */
export function resizeInstanceWithinBounds(
  instance: WidgetInstance,
  axis: 'columns' | 'rows',
  delta: number,
): boolean {
  if (!canResizeWidgetAxis(instance.type, axis) || !Number.isInteger(delta) || delta === 0)
    return false
  const definition = widgetRegistry.get(instance.type)
  if (!definition)
    return false
  const supported = definition.size.supportedSizes
  if (supported?.length) {
    const otherAxis = axis === 'columns' ? 'rows' : 'columns'
    const candidates = supported
      .filter(size => size[otherAxis] === instance.size[otherAxis]
        && (delta > 0 ? size[axis] > instance.size[axis] : size[axis] < instance.size[axis]))
      .sort((a, b) => delta > 0 ? a[axis] - b[axis] : b[axis] - a[axis])
    const target = candidates[Math.min(Math.abs(delta), candidates.length) - 1]
    return target ? resizeInstanceToWithinBounds(instance, target) : false
  }
  const step = definition.size.step?.[axis] ?? 1
  return resizeInstanceToWithinBounds(instance, {
    ...instance.size,
    [axis]: instance.size[axis] + delta * step,
  })
}
