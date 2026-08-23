/**
 * 兼容层：Widget 配置 Schema 构建器已提取到 src/sdk/configSchema.ts，
 * 与 Theme SDK 共享同一套字段构造器与解析语义。
 * 旧导出路径继续可用；错误信息已改为通用 "config" 文案。
 */
export {
  boolean,
  color,
  defineConfigSchema,
  integer,
  enumeration,
  isoDate,
  number,
  string,
  url,
} from '@/sdk/configSchema'

export type {
  BooleanFieldOptions,
  ConfigField,
  DateFieldOptions,
  EnumFieldOptions,
  IntegerFieldOptions,
  NumberFieldOptions,
  StringFieldOptions,
} from '@/sdk/configSchema'
