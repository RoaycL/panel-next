import type { Component } from 'vue'

export const WIDGET_LAYOUT_SCHEMA_VERSION = 1

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
}

export type WidgetMigration = (config: unknown) => unknown

/**
 * 组件能力声明：向宿主与审核流程说明组件将使用的宿主能力。
 * 目前为声明性元数据，未来可映射为运行时权限控制。
 */
export type WidgetCapability = 'network' | 'storage' | 'clipboard' | 'geolocation'

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
}

export interface WidgetLayoutLoadResult {
  layout: WidgetLayout
  droppedWidgetIds: string[]
}
