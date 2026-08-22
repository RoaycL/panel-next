import type { WidgetConfigSchema, WidgetFieldDescriptor } from './types'

interface FieldMetaOptions {
  label?: string
  description?: string
}

/**
 * 声明式组件配置 Schema 构建器。
 *
 * 第三方组件无需手写 parse()：用字段构造器描述每个配置项的约束，
 * 由 defineConfigSchema 组合出符合 WidgetConfigSchema 契约的解析器。
 *
 * 解析语义：
 * - 传入 null/undefined 视为空对象（返回全默认值，便于 create() 免传配置）；
 * - 字段缺失且有默认值 → 填充默认值；
 * - 字段缺失且无默认值（required）→ 抛错；
 * - 类型或约束不符 → 抛错（宿主会丢弃该实例并告警，不会静默篡改用户数据）；
 * - 未声明的多余字段一律剥离。
 */

export interface StringFieldOptions extends FieldMetaOptions {
  default?: string
  min?: number
  max?: number
  pattern?: RegExp
}

export interface IntegerFieldOptions extends FieldMetaOptions {
  default?: number
  min?: number
  max?: number
}

export interface EnumFieldOptions<T extends string> extends FieldMetaOptions {
  values: readonly T[]
  default?: T
}

export interface DateFieldOptions extends FieldMetaOptions {
  /** YYYY-MM-DD；可选默认值 */
  default?: string
}

export interface NumberFieldOptions extends FieldMetaOptions {
  default?: number
  min?: number
  max?: number
}

export interface BooleanFieldOptions extends FieldMetaOptions {}

export type ConfigField<T> = ((value: unknown, key: string) => T) & {
  descriptor: WidgetFieldDescriptor
}

function field<T>(parser: (value: unknown, key: string) => T, descriptor: WidgetFieldDescriptor): ConfigField<T> {
  return Object.assign(parser, { descriptor })
}

function fail(key: string, reason: string): never {
  throw new Error(`Invalid widget config field "${key}": ${reason}`)
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null
}

export function string(options: StringFieldOptions = {}): ConfigField<string> {
  return field((value, key) => {
    if (isMissing(value)) {
      if (options.default !== undefined)
        return options.default
      return fail(key, 'field is required')
    }
    if (typeof value !== 'string')
      return fail(key, 'expected a string')
    if (options.min !== undefined && value.length < options.min)
      return fail(key, `shorter than ${options.min} characters`)
    if (options.max !== undefined && value.length > options.max)
      return fail(key, `longer than ${options.max} characters`)
    if (options.pattern) {
      options.pattern.lastIndex = 0
      if (!options.pattern.test(value))
        return fail(key, 'does not match the required pattern')
    }
    return value
  }, {
    kind: 'string', label: options.label, description: options.description,
    required: options.default === undefined, defaultValue: options.default,
    minimum: options.min, maximum: options.max,
  })
}

export function boolean(defaultValue: boolean, options: BooleanFieldOptions = {}): ConfigField<boolean> {
  return field((value, key) => {
    if (isMissing(value))
      return defaultValue
    if (typeof value !== 'boolean')
      return fail(key, 'expected a boolean')
    return value
  }, { kind: 'boolean', label: options.label, description: options.description, required: false, defaultValue })
}

export function integer(options: IntegerFieldOptions = {}): ConfigField<number> {
  return field((value, key) => {
    const resolved = isMissing(value) ? options.default : value
    if (resolved === undefined)
      return fail(key, 'field is required')
    if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved))
      return fail(key, 'expected an integer')
    if (options.min !== undefined && resolved < options.min)
      return fail(key, `smaller than ${options.min}`)
    if (options.max !== undefined && resolved > options.max)
      return fail(key, `larger than ${options.max}`)
    return resolved
  }, {
    kind: 'integer', label: options.label, description: options.description,
    required: options.default === undefined, defaultValue: options.default,
    minimum: options.min, maximum: options.max,
  })
}

export function number(options: NumberFieldOptions = {}): ConfigField<number> {
  return field((value, key) => {
    const resolved = isMissing(value) ? options.default : value
    if (resolved === undefined)
      return fail(key, 'field is required')
    if (typeof resolved !== 'number' || !Number.isFinite(resolved))
      return fail(key, 'expected a finite number')
    if (options.min !== undefined && resolved < options.min)
      return fail(key, `smaller than ${options.min}`)
    if (options.max !== undefined && resolved > options.max)
      return fail(key, `larger than ${options.max}`)
    return resolved
  }, {
    kind: 'number', label: options.label, description: options.description,
    required: options.default === undefined, defaultValue: options.default,
    minimum: options.min, maximum: options.max,
  })
}

export function enumeration<T extends string>(options: EnumFieldOptions<T>): ConfigField<T> {
  if (!options.values.length || (options.default !== undefined && !options.values.includes(options.default)))
    throw new Error('Invalid widget enum definition.')
  return field((value, key) => {
    const resolved = isMissing(value) ? options.default : value
    if (resolved === undefined)
      return fail(key, 'field is required')
    if (typeof resolved !== 'string' || !options.values.includes(resolved as T))
      return fail(key, `expected one of: ${options.values.join(', ')}`)
    return resolved as T
  }, {
    kind: 'enum', label: options.label, description: options.description,
    required: options.default === undefined, defaultValue: options.default, values: [...options.values],
  })
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 校验 YYYY-MM-DD 且为真实存在的日历日期。 */
export function isoDate(options: DateFieldOptions = {}): ConfigField<string> {
  return field((value, key) => {
    const resolved = isMissing(value) ? options.default : value
    if (resolved === undefined)
      return fail(key, 'field is required')
    if (typeof resolved !== 'string' || !ISO_DATE_PATTERN.test(resolved))
      return fail(key, 'expected format YYYY-MM-DD')
    const [year, month, day] = resolved.split('-').map(Number)
    const probe = new Date(year, month - 1, day)
    if (year < 1900 || probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day)
      return fail(key, 'not a real calendar date')
    return resolved
  }, {
    kind: 'date', label: options.label, description: options.description,
    required: options.default === undefined, defaultValue: options.default,
  })
}

export function url(options: StringFieldOptions = {}): ConfigField<string> {
  const base = string(options)
  return field((value, key) => {
    const resolved = base(value, key)
    let parsed: URL
    try {
      parsed = new URL(resolved)
    }
    catch {
      return fail(key, 'expected a valid URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return fail(key, 'expected an HTTP(S) URL')
    return resolved
  }, { ...base.descriptor, kind: 'url' })
}

export function color(options: StringFieldOptions = {}): ConfigField<string> {
  const base = string(options)
  return field((value, key) => {
    const resolved = base(value, key)
    if (!/^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|[a-z]{1,32})$/i.test(resolved))
      return fail(key, 'expected a safe CSS color')
    return resolved
  }, { ...base.descriptor, kind: 'color' })
}

export function defineConfigSchema<T extends Record<string, any>>(
  shape: { [K in keyof T]: ConfigField<T[K]> },
): WidgetConfigSchema<T> {
  return {
    parse(value) {
      if (value === null || value === undefined)
        value = {}
      if (typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid widget config: expected an object.')
      const source = value as Record<string, unknown>
      const result = {} as Record<string, unknown>
      for (const [key, field] of Object.entries(shape))
        result[key] = field(source[key], key)
      return result as T
    },
    fields: Object.fromEntries(Object.entries(shape).map(([key, configField]) => [key, configField.descriptor])),
  }
}
