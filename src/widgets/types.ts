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

export interface WidgetDefinition<TConfig = unknown> {
  type: string
  currentVersion: number
  configSchema: WidgetConfigSchema<TConfig>
  defaultConfig: () => TConfig
  size: WidgetSizeConstraints
  migrations?: Readonly<Record<number, WidgetMigration>>
  load: () => Promise<Component>
}

export interface WidgetLayoutLoadResult {
  layout: WidgetLayout
  droppedWidgetIds: string[]
}
