import type { Component } from 'vue'

/**
 * Theme SDK 契约类型。
 *
 * 设计边界：
 * - 主题只允许声明数据（Token、配置 Schema、Variant、图标映射），
 *   运行时禁止执行远程 JavaScript、任意 HTML 或任意 CSS 选择器；
 * - `component`（可信源码主题的可选背景渲染 Slot）是【保留且未实现】的预留字段：
 *   ThemeProvider 目前不渲染它，外部主题包会被丢弃（见 themePackage.ts），
 *   源码主题也【不得】依赖它——不要把它当作已支持的公开能力，也绝不要执行该值。
 *   若要启用，必须先实现「受控渲染入口 + 组件错误边界」，并限于随应用
 *   一起打包审核的信任代码。见 scripts/validate-theme-registry.mjs 与 TODO。
 */

export const THEME_SELECTION_SCHEMA_VERSION = 1
export const MAX_THEME_CONFIG_BYTES = 32 * 1024
export const MAX_THEME_OVERRIDES_BYTES = 32 * 1024
export const MAX_THEME_ENVELOPE_BYTES = 64 * 1024

export type ThemeSurface = 'web' | 'extension'
export type ThemeMode = 'light' | 'dark' | 'auto'
export type ResolvedThemeMode = 'light' | 'dark'

/** 内置主题保留前缀；第三方必须使用自己的 `<vendor>.<name>` 命名空间。 */
export const RESERVED_THEME_ID_PREFIX = 'core.'
export const MAX_THEME_ID_LENGTH = 64

/* ---------------------------------- Token ---------------------------------- */

export interface ThemeColorTokens {
  pageBackground: string
  surface: string
  surfaceOverlay: string
  surfaceHover: string
  mask: string
  border: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  accent: string
  success: string
  warning: string
  danger: string
}

export interface ThemeFontTokens {
  family: string
  weightHeading: string
  weightBody: string
}

export interface ThemeRadiusTokens {
  small: string
  medium: string
  large: string
  round: string
}

export interface ThemeSpacingTokens {
  compact: string
  normal: string
  relaxed: string
}

export interface ThemeEffectTokens {
  blur: string
  shadowLow: string
  shadowMedium: string
  shadowHigh: string
  durationFast: string
  durationNormal: string
  durationSlow: string
}

export interface ThemeBookmarkTokens {
  cardBackground: string
  cardBorder: string
  cardShadow: string
  titleColor: string
  descriptionColor: string
  iconBackground: string
  iconRadius: string
}

export interface ThemeWidgetTokens {
  background: string
  border: string
  shadow: string
  textColor: string
  mutedText: string
  loadingColor: string
  errorColor: string
  errorBorder: string
  retryBackground: string
  retryBorder: string
  /** 图表/趋势色板，至少 1 色、至多 8 色。 */
  chartColors: readonly string[]
}

export interface ThemeSidebarTokens {
  background: string
  border: string
  hoverBackground: string
  activeBackground: string
  textColor: string
  activeTextColor: string
}

export interface ThemeModalTokens {
  background: string
  overlay: string
  border: string
  titleTextColor: string
  contentTextColor: string
}

export interface ThemeNotificationTokens {
  background: string
  titleTextColor: string
  contentTextColor: string
  successColor: string
  warningColor: string
  errorColor: string
  boxShadow: string
}

export interface ThemeIconTokens {
  defaultColor: string
  activeColor: string
}

export interface ThemeTokens {
  color: ThemeColorTokens
  font: ThemeFontTokens
  radius: ThemeRadiusTokens
  spacing: ThemeSpacingTokens
  effect: ThemeEffectTokens
  bookmark: ThemeBookmarkTokens
  widget: ThemeWidgetTokens
  sidebar: ThemeSidebarTokens
  modal: ThemeModalTokens
  notification: ThemeNotificationTokens
  icon: ThemeIconTokens
}

/** 第三方主题允许只覆盖部分 Token，解析时用默认 Token 深度补齐。 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly (infer U)[] ? readonly U[] : DeepPartial<T[K]>
}
export type ThemeTokenOverrides = DeepPartial<ThemeTokens>

/* --------------------------------- Variant --------------------------------- */

export type BookmarkVariant = 'glass' | 'solid' | 'minimal'
export type WidgetVariant = 'glass' | 'solid' | 'borderless'
export type SidebarVariant = 'floating' | 'attached' | 'minimal'
export type SearchVariant = 'pill' | 'box' | 'underline'

export interface ThemeVariants {
  bookmark: BookmarkVariant
  widget: WidgetVariant
  sidebar: SidebarVariant
  search: SearchVariant
}

export type ThemeVariantOverrides = { [K in keyof ThemeVariants]?: ThemeVariants[K] }

/* ---------------------------------- Icon ----------------------------------- */

/**
 * 系统功能语义图标名。图标包把语义名映射为本地 SVG 资源或 Iconify 名称，
 * 单色图标必须使用 currentColor；用户上传图片/favicon 不受主题染色影响。
 */
export const THEME_ICON_NAMES = [
  'settings',
  'close',
  'add',
  'refresh',
  'edit',
  'delete',
  'search',
  'save',
  'check',
  'warning',
  'info',
  'more',
  'drag',
  'toTop',
  'externalLink',
  'user',
  'logout',
  'upload',
  'download',
  'copy',
  'theme',
  'wallpaper',
  'language',
  'sync',
  'folder',
  'dashboard',
  'networkWired',
  'networkWireless',
  'eye',
  'eyeOff',
  'chevronRight',
  'darkMode',
  'lightMode',
] as const

export type ThemeIconName = typeof THEME_ICON_NAMES[number]
/** 语义名 → 本地 SVG 名或 Iconify 名称（如 `mdi:pencil`）。 */
export type ThemeIconSet = Readonly<Record<ThemeIconName, string>>

/* ------------------------------ Config Schema ------------------------------ */

export type ThemeFieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'date' | 'url' | 'color'

export interface ThemeFieldDescriptor {
  kind: ThemeFieldKind
  label?: string
  description?: string
  required: boolean
  defaultValue?: unknown
  minimum?: number
  maximum?: number
  values?: readonly string[]
}

export interface ThemeConfigSchema<TConfig> {
  parse: (value: unknown) => TConfig
  fields?: Readonly<Record<string, ThemeFieldDescriptor>>
}

export type ThemeMigration = (config: unknown) => unknown

/* ------------------------------- Definition -------------------------------- */

export interface ThemeMeta {
  name: string
  description?: string
  author?: string
  homepage?: string
  /** 预览图：仅允许本地资源路径或 data:image 安全引用。 */
  preview?: string
}

/**
 * 主题定义：第三方只需注册该对象即可出现在主题中心。
 * - id 规则：小写、最多 64 字符，推荐 `<vendor>.<name>`；`core.` 前缀保留给内置主题；
 * - version 必须为 >= 1 的 JavaScript 安全整数；
 * - surfaces 缺省表示 Web 与 Extension 均可使用。
 */
export interface ThemeDefinition<TConfig = unknown> {
  id: string
  version: number
  meta: ThemeMeta
  tokens?: {
    light?: ThemeTokenOverrides
    dark?: ThemeTokenOverrides
  }
  icons?: Partial<ThemeIconSet>
  variants?: ThemeVariantOverrides
  surfaces?: readonly ThemeSurface[]
  configSchema: ThemeConfigSchema<TConfig>
  defaultConfig: () => TConfig
  migrations?: Readonly<Record<number, ThemeMigration>>
  /**
   * 可信源码主题专用：根据配置与明暗模式生成动态 Token 覆盖。
   * 数据化主题包（§15）禁止携带该字段。
   */
  resolveTokens?: (config: TConfig, mode: ResolvedThemeMode) => ThemeTokenOverrides
  /**
   * @deprecated 保留字段，未实现且【禁止使用/执行】。ThemeProvider 不渲染它，
   * 外部数据主题包会被丢弃（themePackage.ts），可信源码主题也不得依赖它。
   * 该字段仅用于向后兼容占位；在启用「受控渲染入口 + 错误边界」前禁止读取/执行。
   */
  component?: Component
}

/* ------------------------------ Wire Selection ----------------------------- */

/** 主题选择信封 v1：双端存储与服务端 wire 校验的统一结构。 */
export interface ThemeSelection<TConfig = unknown> {
  schemaVersion: typeof THEME_SELECTION_SCHEMA_VERSION
  themeId: string
  /** 写入时的主题版本，用于触发连续迁移。 */
  themeVersion: number
  mode: ThemeMode
  config?: TConfig
  overrides?: ThemeTokenOverrides
  variants?: ThemeVariantOverrides
  iconPackId?: string
}

export interface ThemeContext {
  surface: ThemeSurface
  resolvedMode: ResolvedThemeMode
  themeId: string
  runtimeKind: string
}

export interface ThemeLoadIssue {
  reason: string
  preserved: boolean
}

export interface ThemeLoadResult<TConfig = unknown> {
  /** 始终可用：隔离场景下回退 core.default 的解析结果。 */
  resolved: ResolvedTheme<TConfig>
  /** 归一化后的选择；隔离场景保持原始数据以便升级恢复。 */
  selection: ThemeSelection<TConfig> | null
  quarantined: boolean
  issues: ThemeLoadIssue[]
}

export interface ResolvedTheme<TConfig = unknown> {
  definition: ThemeDefinition<TConfig>
  id: string
  /** 深度补齐后的完整 Token，对组件只读。 */
  tokens: Readonly<ThemeTokens>
  icons: Readonly<ThemeIconSet>
  variants: Readonly<ThemeVariants>
  config: TConfig
  overridesApplied: boolean
  quarantined: boolean
}

export function isThemeSurface(value: unknown): value is ThemeSurface {
  return value === 'web' || value === 'extension'
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'auto'
}
