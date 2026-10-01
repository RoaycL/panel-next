import type { ThemeSelection } from './types'
import {
  BOOKMARK_VARIANTS,
  SEARCH_VARIANTS,
  SIDEBAR_VARIANTS,
  THEME_ID_PATTERN,
  THEME_ICON_PACK_ID_PATTERN,
  WIDGET_VARIANTS,
} from './constants'
import {
  MAX_THEME_CONFIG_BYTES,
  MAX_THEME_ENVELOPE_BYTES,
  MAX_THEME_OVERRIDES_BYTES,
  THEME_SELECTION_SCHEMA_VERSION,
} from './types'

/**
 * 主题选择信封的传输契约校验：与 Go 端 themeValidation.go 保持同一套规则
 * （ID 正则、字段可选性、安全整数版本、字节上限与 JSON 转义口径）。
 * 本函数不依赖注册表，可在加载、保存、导入前独立运行。
 */

/** 与 src/widgets/registry.ts#jsonSize 相同口径：匹配 Go json.Marshal 的转义字节数。 */
const GO_ESCAPED_SIX_BYTES = new Set(['<', '>', '&', '\u2028', '\u2029'])

export function jsonSize(value: unknown): number {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

const MODES = new Set(['light', 'dark', 'auto'])

export function validateThemeWallpapers(value: unknown): string | null {
  if (!isPlainObject(value)) return 'wallpapers must be an object'
  for (const [mode, url] of Object.entries(value)) {
    if (mode !== 'light' && mode !== 'dark') return 'invalid wallpaper mode'
    if (typeof url !== 'string' || new TextEncoder().encode(url).length > 4096 || url.includes('\\') || Array.from(url).some(char => char.charCodeAt(0) <= 32)) return 'invalid wallpaper URL'
    if (!url) continue
    if (url.startsWith('/') && !url.startsWith('//')) continue
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return 'invalid wallpaper URL'
    }
    catch { return 'invalid wallpaper URL' }
  }
  return null
}

export function validateThemeWallpaperMap(value: unknown): string | null {
  if (!isPlainObject(value) || Object.keys(value).length > 50) return 'invalid theme wallpaper map'
  for (const [id, pair] of Object.entries(value)) {
    if (!THEME_ID_PATTERN.test(id)) return 'invalid wallpaper theme id'
    const error = validateThemeWallpapers(pair)
    if (error) return error
  }
  return null
}

/**
 * 结构级信封校验。返回违规描述；合法时返回 null。
 * 该校验不判断主题是否已注册——未知主题同样必须满足结构契约才能进入隔离区保留。
 */
export function validateThemeWireSelection(candidate: unknown): string | null {
  if (!isPlainObject(candidate))
    return 'theme selection must be an object'
  if (jsonSize(candidate) > MAX_THEME_ENVELOPE_BYTES)
    return 'theme selection exceeds 64 KiB'
  if (candidate.schemaVersion !== THEME_SELECTION_SCHEMA_VERSION)
    return 'unsupported theme selection schema version'
  const themeId = candidate.themeId
  if (typeof themeId !== 'string' || !THEME_ID_PATTERN.test(themeId))
    return 'invalid theme id'
  if (!isSafePositiveInteger(candidate.themeVersion))
    return 'invalid theme version'
  const mode = candidate.mode
  if (typeof mode !== 'string' || !MODES.has(mode))
    return 'invalid theme mode'
  if (candidate.config !== undefined) {
    if (!isPlainObject(candidate.config))
      return 'theme config must be an object'
    if (jsonSize(candidate.config) > MAX_THEME_CONFIG_BYTES)
      return 'theme config exceeds 32 KiB'
  }
  if (candidate.wallpapers !== undefined) {
    const error = validateThemeWallpaperMap(candidate.wallpapers)
    if (error) return error
  }
  if (candidate.overrides !== undefined) {
    if (!isPlainObject(candidate.overrides))
      return 'theme overrides must be an object'
    if (jsonSize(candidate.overrides) > MAX_THEME_OVERRIDES_BYTES)
      return 'theme overrides exceed 32 KiB'
  }
  if (candidate.variants !== undefined) {
    if (!isPlainObject(candidate.variants))
      return 'theme variants must be an object'
    const variantError = validateVariantOverrides(candidate.variants)
    if (variantError)
      return variantError
  }
  if (candidate.iconPackId !== undefined && candidate.iconPackId !== null) {
    if (typeof candidate.iconPackId !== 'string' || !THEME_ICON_PACK_ID_PATTERN.test(candidate.iconPackId))
      return 'invalid icon pack id'
  }
  return null
}

export function validateVariantOverrides(variants: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(variants)) {
    switch (key) {
      case 'bookmark':
        if (typeof value === 'string' && BOOKMARK_VARIANTS.includes(value))
          break
        return 'invalid bookmark variant'
      case 'widget':
        if (typeof value === 'string' && WIDGET_VARIANTS.includes(value))
          break
        return 'invalid widget variant'
      case 'sidebar':
        if (typeof value === 'string' && SIDEBAR_VARIANTS.includes(value))
          break
        return 'invalid sidebar variant'
      case 'search':
        if (typeof value === 'string' && SEARCH_VARIANTS.includes(value))
          break
        return 'invalid search variant'
      default:
        return `unknown variant "${key}"`
    }
  }
  return null
}

/** 归一化：剥离未知字段，补齐必需字段。调用前先用 validateThemeWireSelection 校验。 */
export function normalizeThemeSelection<TConfig = unknown>(candidate: unknown): ThemeSelection<TConfig> {
  const source = candidate as Record<string, unknown>
  return {
    schemaVersion: THEME_SELECTION_SCHEMA_VERSION,
    themeId: source.themeId as string,
    themeVersion: source.themeVersion as number,
    mode: source.mode as ThemeSelection['mode'],
    ...(source.wallpapers !== undefined ? { wallpapers: source.wallpapers as ThemeSelection['wallpapers'] } : {}),
    config: source.config as TConfig | undefined,
    overrides: source.overrides as ThemeSelection['overrides'],
    variants: source.variants as ThemeSelection['variants'],
    iconPackId: typeof source.iconPackId === 'string' ? source.iconPackId : undefined,
  }
}
