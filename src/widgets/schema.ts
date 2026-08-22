import type { WidgetConfigSchema } from './types'

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

export interface StringFieldOptions {
  default?: string
  min?: number
  max?: number
  pattern?: RegExp
}

export interface IntegerFieldOptions {
  default?: number
  min?: number
  max?: number
}

export interface EnumFieldOptions<T extends string> {
  values: readonly T[]
  default?: T
}

export interface DateFieldOptions {
  /** YYYY-MM-DD；可选默认值 */
  default?: string
}

export type ConfigField<T> = (value: unknown, key: string) => T

function fail(key: string, reason: string): never {
  throw new Error(`Invalid widget config field "${key}": ${reason}`)
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null
}

export function string(options: StringFieldOptions = {}): ConfigField<string> {
  return (value, key) => {
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
    if (options.pattern && !options.pattern.test(value))
      return fail(key, 'does not match the required pattern')
    return value
  }
}

export function boolean(defaultValue: boolean): ConfigField<boolean> {
  return (value, key) => {
    if (isMissing(value))
      return defaultValue
    if (typeof value !== 'boolean')
      return fail(key, 'expected a boolean')
    return value
  }
}

export function integer(options: IntegerFieldOptions = {}): ConfigField<number> {
  return (value, key) => {
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
  }
}

export function enumeration<T extends string>(options: EnumFieldOptions<T>): ConfigField<T> {
  return (value, key) => {
    const resolved = isMissing(value) ? options.default : value
    if (resolved === undefined)
      return fail(key, 'field is required')
    if (typeof resolved !== 'string' || !options.values.includes(resolved as T))
      return fail(key, `expected one of: ${options.values.join(', ')}`)
    return resolved as T
  }
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 校验 YYYY-MM-DD 且为真实存在的日历日期。 */
export function isoDate(options: DateFieldOptions = {}): ConfigField<string> {
  return (value, key) => {
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
  }
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
  }
}
