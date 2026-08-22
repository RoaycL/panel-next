import type { Component } from 'vue'

export const WIDGET_LAYOUT_SCHEMA_VERSION = 1
export const MAX_WIDGET_INSTANCES = 100
export const MAX_WIDGET_LAYOUT_BYTES = 256 * 1024
export const MAX_WIDGET_CONFIG_BYTES = 32 * 1024

export interface WidgetPosition {
  column: number
  row: number
}

export interface WidgetSize {
  columns: number
  rows: number
}

export interface WidgetSizeConstraints {
  default: WidgetSize
  min: WidgetSize
  max: WidgetSize
}

export interface WidgetInstance<TConfig = unknown> {
  id: string
  type: string
  version: number
  position: WidgetPosition
  size: WidgetSize
  hidden: boolean
  config: TConfig
}

export interface WidgetLayout {
  schemaVersion: typeof WIDGET_LAYOUT_SCHEMA_VERSION
  widgets: WidgetInstance[]
}

export interface WidgetConfigSchema<TConfig> {
  parse: (value: unknown) => TConfig
  fields?: Readonly<Record<string, WidgetFieldDescriptor>>
}

export type WidgetMigration = (config: unknown) => unknown

/**
 * 组件能力声明：向宿主与审核流程说明组件将使用的宿主能力。
 * 运行时在 SDK 初始化及调用时通过能力闸门进行严格授权检查；
 * 声明制授权闸门用于快速失败与可诊断错误，真正的第三方代码隔离需沙箱机制。
 */
export type WidgetCapability = 'network' | 'storage' | 'clipboard' | 'geolocation'
export type WidgetSurface = 'web' | 'extension'
export type WidgetFieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'date' | 'url' | 'color'

export interface WidgetFieldDescriptor {
  kind: WidgetFieldKind
  label?: string
  description?: string
  required: boolean
  defaultValue?: unknown
  minimum?: number
  maximum?: number
  values?: readonly string[]
}

/**
 * 组件自描述元数据：
 * - title/description 支持 i18n key（如 `widgetLayout.types.core.clock`）或字面文案；
 * - icon 为本地图标名（见 src/assets/svg-icons 命名规则）。
 */
export interface WidgetMeta {
  title: string
  description?: string
  icon?: string
}

export interface WidgetDefinition<TConfig = unknown> {
  /** 全局唯一类型标识，推荐 `<vendor>.<name>` 命名空间格式（如 `acme.stock`）。 */
  type: string
  currentVersion: number
  configSchema: WidgetConfigSchema<TConfig>
  defaultConfig: () => TConfig
  size: WidgetSizeConstraints
  migrations?: Readonly<Record<number, WidgetMigration>>
  load: () => Promise<Component>
  meta?: WidgetMeta
  capabilities?: readonly WidgetCapability[]
  surfaces?: readonly WidgetSurface[]
}

export interface WidgetLoadIssue {
  id: string
  reason: string
  preserved: boolean
}

export interface WidgetLayoutLoadResult {
  layout: WidgetLayout
  droppedWidgetIds: string[]
  quarantinedWidgets: unknown[]
  issues: WidgetLoadIssue[]
}
