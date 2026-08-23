import type { ThemeTokens } from './types'
import { CSS_VARIABLE_PREFIX } from './constants'

/**
 * Token 值严格解析器：主题只能输出受控的 CSS 值，
 * 不允许拼接任意字符串造成样式注入。
 */

export class ThemeValueError extends Error {}

const COLOR_PATTERN = new RegExp(
  '^(?:'
  + '#[0-9a-fA-F]{3,4}'
  + '|#[0-9a-fA-F]{6}'
  + '|#[0-9a-fA-F]{8}'
  + '|rgba?\\(\\s*(?:\\d{1,3}\\s*,\\s*){2}\\d{1,3}\\s*(?:,\\s*(?:0|1|0?\\.\\d+)\\s*)?\\)'
  + '|hsla?\\(\\s*\\d{1,3}\\s*,\\s*\\d{1,3}%\\s*,\\s*\\d{1,3}%\\s*(?:,\\s*(?:0|1|0?\\.\\d+)\\s*)?\\)'
  + ')$',
)

/** 受控 CSS 颜色关键字白名单（避免依赖完整 CSS 关键字表）。 */
const NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'white', 'black', 'red', 'green', 'blue',
  'orange', 'yellow', 'purple', 'pink', 'gray', 'grey', 'slategray',
])

export function parseColor(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length > 64)
    throw new ThemeValueError(`Invalid color token "${key}".`)
  const normalized = value.trim()
  if (COLOR_PATTERN.test(normalized) || NAMED_COLORS.has(normalized.toLowerCase()))
    return normalized
  throw new ThemeValueError(`Invalid color token "${key}".`)
}

export function parseLength(value: unknown, key: string): string {
  if (typeof value !== 'string')
    throw new ThemeValueError(`Invalid length token "${key}".`)
  const normalized = value.trim()
  // 禁止 calc()/var() 等复合表达式，保持值可预测。
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|rem|em|%|vh|vw)?$/.test(normalized))
    throw new ThemeValueError(`Invalid length token "${key}".`)
  return normalized
}

export function parseBlur(value: unknown, key: string): string {
  if (typeof value === 'string' && value.trim() === 'none')
    return 'none'
  return parseLength(value, key)
}

export function parseDuration(value: unknown, key: string): string {
  if (typeof value !== 'string')
    throw new ThemeValueError(`Invalid duration token "${key}".`)
  const normalized = value.trim()
  if (!/^\d+(?:\.\d+)?m?s$/.test(normalized))
    throw new ThemeValueError(`Invalid duration token "${key}".`)
  return normalized
}

export function parseFontWeight(value: unknown, key: string): string {
  if (typeof value !== 'string')
    throw new ThemeValueError(`Invalid font weight token "${key}".`)
  const normalized = value.trim()
  if (!/^(?:[1-9]00|bold|normal)$/.test(normalized))
    throw new ThemeValueError(`Invalid font weight token "${key}".`)
  return normalized
}

export function parseFontFamily(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length > 256)
    throw new ThemeValueError(`Invalid font family token "${key}".`)
  const normalized = value.trim()
  // 仅允许标识符、带引号名称、通用族与逗号/空格分隔。
  if (!/^[\w-]+(?:\s+"[\w -]+")*(?:\s*,\s*(?:[\w-]+|"[\w -]+"))*$/.test(normalized))
    throw new ThemeValueError(`Invalid font family token "${key}".`)
  return normalized
}

/**
 * 阴影语法白名单：由长度、颜色、inset 关键字组成的逗号分层列表，
 * 拒绝 url()、var()、expression() 等危险函数。
 */
export function parseShadow(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length > 512)
    throw new ThemeValueError(`Invalid shadow token "${key}".`)
  const normalized = value.trim().toLowerCase()
  if (!normalized || /(?:url|var|calc|expression|attr)\(/.test(normalized) || /[;{}]/.test(normalized))
    throw new ThemeValueError(`Invalid shadow token "${key}".`)
  for (const layer of splitTopLevel(normalized)) {
    const parts = layer.trim().split(/\s+/).filter(Boolean)
    let lengthCount = 0
    for (const part of parts) {
      if (part === 'inset')
        continue
      if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|rem|em)?(?:\/.+)?$/.test(part)) {
        lengthCount++
        continue
      }
      if (/^#[0-9a-f]{3,8}$/.test(part))
        continue
      if (/^rgba?\(/.test(part) || /^hsla?\(/.test(part))
        continue
      if (NAMED_COLORS.has(part))
        continue
      throw new ThemeValueError(`Invalid shadow layer in token "${key}".`)
    }
    if (lengthCount < 2 || lengthCount > 4)
      throw new ThemeValueError(`Invalid shadow geometry in token "${key}".`)
  }
  return normalized
}

function splitTopLevel(value: string): string[] {
  const layers: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(')
      depth++
    if (char === ')')
      depth--
    if (char === ',' && depth === 0) {
      layers.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim())
    layers.push(current)
  return layers
}

export function parseNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ThemeValueError(`Invalid number token "${key}".`)
  return value
}

/* --------------------------- Token → CSS Variables -------------------------- */

type ValueParser = (value: unknown, key: string) => string
const RADIUS_KEYS = ['small', 'medium', 'large', 'round']
const SPACING_KEYS = ['compact', 'normal', 'relaxed']
const COLOR_PARSERS: Record<string, ValueParser> = {
  pageBackground: parseColor,
  surface: parseColor,
  surfaceOverlay: parseColor,
  surfaceHover: parseColor,
  mask: parseColor,
  border: parseColor,
  textPrimary: parseColor,
  textSecondary: parseColor,
  textMuted: parseColor,
  accent: parseColor,
  success: parseColor,
  warning: parseColor,
  danger: parseColor,
}
const FONT_PARSERS: Record<string, ValueParser> = {
  family: parseFontFamily,
  weightHeading: parseFontWeight,
  weightBody: parseFontWeight,
}
const RADIUS_PARSERS: Record<string, ValueParser> = Object.fromEntries(RADIUS_KEYS.map(key => [key, parseLength]))
const SPACING_PARSERS: Record<string, ValueParser> = Object.fromEntries(SPACING_KEYS.map(key => [key, parseLength]))
const EFFECT_PARSERS: Record<string, ValueParser> = {
  blur: parseBlur,
  shadowLow: parseShadow,
  shadowMedium: parseShadow,
  shadowHigh: parseShadow,
  durationFast: parseDuration,
  durationNormal: parseDuration,
  durationSlow: parseDuration,
}
const BOOKMARK_PARSERS: Record<string, ValueParser> = {
  cardBackground: parseColor,
  cardBorder: parseColor,
  cardShadow: parseShadow,
  titleColor: parseColor,
  descriptionColor: parseColor,
  iconBackground: parseColor,
  iconRadius: parseLength,
}
const WIDGET_SCALAR_PARSERS: Record<string, ValueParser> = {
  background: parseColor,
  border: parseColor,
  shadow: parseShadow,
  textColor: parseColor,
  mutedText: parseColor,
  loadingColor: parseColor,
  errorColor: parseColor,
  errorBorder: parseColor,
  retryBackground: parseColor,
  retryBorder: parseColor,
}
const SIDEBAR_PARSERS: Record<string, ValueParser> = {
  background: parseColor,
  border: parseColor,
  hoverBackground: parseColor,
  activeBackground: parseColor,
  textColor: parseColor,
  activeTextColor: parseColor,
}
const MODAL_PARSERS: Record<string, ValueParser> = {
  background: parseColor,
  overlay: parseColor,
  border: parseColor,
  titleTextColor: parseColor,
  contentTextColor: parseColor,
}
const NOTIFICATION_PARSERS: Record<string, ValueParser> = {
  background: parseColor,
  titleTextColor: parseColor,
  contentTextColor: parseColor,
  successColor: parseColor,
  warningColor: parseColor,
  errorColor: parseColor,
  boxShadow: parseShadow,
}
const ICON_PARSERS: Record<string, ValueParser> = {
  defaultColor: parseColor,
  activeColor: parseColor,
}


function kebabize(input: string): string {
  return input.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase()
}

/** 将色板展开为 --pn-<name>-<index> 单值变量，便于 color 等属性安全引用。 */
function flattenIndexed(name: string, list: readonly unknown[], parser: ValueParser, out: Record<string, string>) {
  list.forEach((item, index) => {
    const parsed = parser(item, `${name}[${index}]`)
    out[`${cssVarName(name)}-${index}`] = parsed
  })
}

function cssVarName(flat: string): string {
  return CSS_VARIABLE_PREFIX + flat.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase()
}

function flattenGroup(group: string, values: Record<string, unknown> | undefined, parsers: Record<string, ValueParser>, out: Record<string, string>) {
  for (const [rawKey, rawValue] of Object.entries(values ?? {})) {
    if (rawValue === undefined)
      continue
    const parser = parsers[rawKey]
    const flat = `${group}-${kebabize(rawKey)}`
    if (!parser)
      throw new ThemeValueError(`Unknown theme token "${flat}".`)
    out[cssVarName(flat)] = parser(rawValue, flat)
  }
}

function flattenList(name: string, list: readonly unknown[], parser: ValueParser, out: Record<string, string>) {
  const parsed = list.map(item => parser(item, name))
  out[cssVarName(name)] = parsed.join(',')
}

/**
 * 将解析后的完整 Token 展平为 --pn-* CSS 变量集合。
 * 输入必须是已经通过 resolve 补齐的完整 Token；任何未知键都会抛错。
 */
export function tokensToCssVariables(tokens: Readonly<ThemeTokens>): Record<string, string> {
  const out: Record<string, string> = {}
  flattenGroup('color', tokens.color as unknown as Record<string, unknown>, COLOR_PARSERS, out)
  flattenGroup('font', tokens.font as unknown as Record<string, unknown>, FONT_PARSERS, out)
  flattenGroup('radius', tokens.radius as unknown as Record<string, unknown>, RADIUS_PARSERS, out)
  flattenGroup('spacing', tokens.spacing as unknown as Record<string, unknown>, SPACING_PARSERS, out)
  flattenGroup('effect', tokens.effect as unknown as Record<string, unknown>, EFFECT_PARSERS, out)
  flattenGroup('bookmark', tokens.bookmark as unknown as Record<string, unknown>, BOOKMARK_PARSERS, out)
  flattenGroup('widget', widgetScalar(tokens.widget), WIDGET_SCALAR_PARSERS, out)
  flattenGroup('sidebar', tokens.sidebar as unknown as Record<string, unknown>, SIDEBAR_PARSERS, out)
  flattenGroup('modal', tokens.modal as unknown as Record<string, unknown>, MODAL_PARSERS, out)
  flattenGroup('notification', tokens.notification as unknown as Record<string, unknown>, NOTIFICATION_PARSERS, out)
  flattenGroup('icon', tokens.icon as unknown as Record<string, unknown>, ICON_PARSERS, out)
  flattenList('widget-chart-colors', tokens.widget.chartColors, parseColor, out)
  flattenIndexed('widget-chart-color', tokens.widget.chartColors, parseColor, out)
  return out
}

function widgetScalar(widget: ThemeTokens['widget']) {
  const { chartColors: _chartColors, ...scalars } = widget
  return scalars
}
