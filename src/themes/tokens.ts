import type { ResolvedThemeMode, ThemeTokenOverrides, ThemeTokens } from './types'
import { cloneJson } from './clone'

/**
 * 默认 Token 集：视觉上对齐当前 Panel Next 默认风格。
 * core.default 必须完整提供所有 Token；第三方主题允许部分覆盖，
 * 解析结果始终用该默认集深度补齐。
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 深度冻结：嵌套对象与数组（如 chartColors）全部只读。 */
export function deepFreezeTokens<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) {
    value.forEach(element => deepFreezeTokens(element))
    return Object.freeze(value)
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach(child => deepFreezeTokens(child))
    return Object.freeze(value)
  }
  return value
}

export const DEFAULT_LIGHT_TOKENS: Readonly<ThemeTokens> = deepFreezeTokens({
  color: {
    pageBackground: '#eef8ff',
    surface: 'rgba(255,255,255,0.92)',
    surfaceOverlay: 'rgba(15,23,42,0.55)',
    surfaceHover: 'rgba(148,163,184,0.14)',
    mask: 'rgba(2,6,23,0.35)',
    border: 'rgba(148,163,184,0.28)',
    textPrimary: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    accent: '#10b981',
    success: '#34d399',
    warning: '#f59e0b',
    danger: '#f87171',
  },
  font: {
    family: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif',
    weightHeading: '600',
    weightBody: '400',
  },
  radius: {
    small: '8px',
    medium: '12px',
    large: '18px',
    round: '999px',
  },
  spacing: {
    compact: '4px',
    normal: '10px',
    relaxed: '20px',
  },
  effect: {
    blur: '14px',
    shadowLow: '0 1px 3px rgba(2,6,23,0.18)',
    shadowMedium: '0 10px 30px rgba(2,6,23,0.22)',
    shadowHigh: '0 22px 60px rgba(2,6,23,0.30)',
    durationFast: '120ms',
    durationNormal: '220ms',
    durationSlow: '360ms',
  },
  bookmark: {
    cardBackground: 'rgba(255,255,255,0.86)',
    cardBorder: 'rgba(255,255,255,0.55)',
    cardShadow: '0 8px 24px rgba(2,6,23,0.16)',
    titleColor: '#1e293b',
    descriptionColor: '#64748b',
    iconBackground: 'rgba(241,245,249,0.9)',
    iconRadius: '12px',
  },
  widget: {
    background: 'rgba(255,255,255,0.9)',
    border: 'rgba(148,163,184,0.26)',
    shadow: '0 10px 30px rgba(71,85,105,0.16)',
    textColor: '#1e293b',
    mutedText: '#64748b',
    loadingColor: '#64748b',
    errorColor: '#b91c1c',
    errorBorder: 'rgba(185,28,28,0.3)',
    retryBackground: 'rgba(226,232,240,0.72)',
    retryBorder: 'rgba(100,116,139,0.28)',
    chartColors: ['#34d399', '#38bdf8', '#f59e0b', '#a78bfa', '#f87171', '#4ade80', '#fbbf24', '#60a5fa'],
  },
  sidebar: {
    background: 'rgba(248,250,252,0.94)',
    border: 'rgba(148,163,184,0.24)',
    hoverBackground: 'rgba(226,232,240,0.72)',
    activeBackground: 'rgba(14,165,233,0.14)',
    textColor: '#475569',
    activeTextColor: '#0369a1',
  },
  modal: {
    background: 'rgba(255,255,255,0.98)',
    overlay: 'rgba(2,6,23,0.55)',
    border: 'rgba(148,163,184,0.24)',
    titleTextColor: '#0f172a',
    contentTextColor: '#334155',
  },
  notification: {
    background: 'rgba(255,255,255,0.97)',
    titleTextColor: '#0f172a',
    contentTextColor: '#334155',
    successColor: '#34d399',
    warningColor: '#f59e0b',
    errorColor: '#f87171',
    boxShadow: '0 22px 60px rgba(2,6,23,0.48)',
  },
  icon: {
    defaultColor: '#1e293b',
    activeColor: '#0284c7',
  },
})

/** 暗色 Token：在浅色集基础上替换表面/文字等关键值，保证 auto 模式切换有真实视觉差异。 */
const DARK_OVERRIDES = Object.freeze(completeTokens(DEFAULT_LIGHT_TOKENS, {
  color: {
    pageBackground: '#020617',
    surface: 'rgba(2,6,23,0.82)',
    surfaceHover: 'rgba(148,163,184,0.10)',
    border: 'rgba(71,85,105,0.42)',
    textPrimary: '#f8fafc',
    textSecondary: '#cbd5e1',
    textMuted: '#94a3b8',
  },
  bookmark: {
    cardBackground: 'rgba(15,23,42,0.78)',
    titleColor: '#e2e8f0',
    descriptionColor: '#94a3b8',
    iconBackground: 'rgba(30,41,59,0.9)',
  },
  widget: {
    background: 'rgba(15,23,42,0.78)',
    border: 'rgba(255,255,255,0.16)',
    shadow: '0 10px 30px rgba(2,6,23,0.25)',
    textColor: '#f8fafc',
    mutedText: 'rgba(248,250,252,0.62)',
    loadingColor: 'rgba(248,250,252,0.58)',
    errorColor: '#fecaca',
    errorBorder: 'rgba(248,113,113,0.32)',
    retryBackground: 'rgba(255,255,255,0.08)',
    retryBorder: 'rgba(255,255,255,0.22)',
  },
  sidebar: {
    background: 'rgba(15,23,42,0.78)',
    border: 'rgba(255,255,255,0.16)',
    hoverBackground: 'rgba(255,255,255,0.12)',
    activeBackground: 'rgba(14,165,233,0.22)',
    textColor: 'rgba(248,250,252,0.82)',
    activeTextColor: '#ffffff',
  },
  modal: {
    background: 'rgba(15,23,42,0.98)',
    titleTextColor: '#f8fafc',
    contentTextColor: '#cbd5e1',
  },
  notification: {
    background: 'rgba(15,23,42,0.97)',
    titleTextColor: '#f8fafc',
    contentTextColor: '#cbd5e1',
  },
  icon: {
    defaultColor: '#ffffff',
    activeColor: '#38bdf8',
  },
}))

export const DEFAULT_DARK_TOKENS: Readonly<ThemeTokens> = deepFreezeTokens(DARK_OVERRIDES as unknown as ThemeTokens)

/** 递归深度合并：后者覆盖前者叶子值，普通对象递归合并，数组整体替换。 */
export function deepMergeTokens(base: unknown, override: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = isPlainObject(base) ? cloneJson(base) : {}
  if (!isPlainObject(override))
    return result
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined)
      continue
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? deepMergeTokens(result[key], value)
      : cloneJson(value)
  }
  return result
}

/**
 * 深度补齐：overrides 只允许出现默认 Token 中已存在的键，
 * 数组（如图表色板）整体替换。返回全新对象，调用方可自由冻结。
 */
export function completeTokens(base: unknown, overrides?: unknown): Record<string, unknown> {
  if (!isPlainObject(base))
    throw new Error('Invalid base tokens.')
  if (!isPlainObject(overrides))
    return cloneJson(base)
  const result: Record<string, unknown> = cloneJson(base)
  for (const [key, overrideValue] of Object.entries(overrides)) {
    if (overrideValue === undefined)
      continue
    if (!(key in result))
      throw new Error(`Unknown theme token key "${key}".`)
    const baseValue = result[key]
    result[key] = isPlainObject(baseValue) && !Array.isArray(baseValue)
      ? completeTokens(baseValue, overrideValue)
      : cloneJson(overrideValue)
  }
  return result
}

/** 冻结完整 Token 树（浅层兼容入口），保证组件拿到只读视图。 */
export function freezeTokens(tokens: Record<string, unknown>): Readonly<ThemeTokens> {
  const cloned = cloneJson(tokens)
  deepFreezeTokens(cloned)
  return deepFreezeTokens(cloned as unknown as ThemeTokens)
}

/** Extension default surfaces. User overrides and third-party themes remain authoritative. */
export function extensionDefaultTokens(mode: ResolvedThemeMode, overrides?: ThemeTokenOverrides): Readonly<ThemeTokens> {
  const dark = mode === 'dark'
  const text = dark ? '#f5f5f5' : '#171717'
  const secondary = dark ? '#d4d4d4' : '#404040'
  const muted = dark ? '#a3a3a3' : '#737373'
  // Night glass is a cool, see-through smoke tint: the blurred wallpaper keeps its colour.
  const surface = dark ? 'rgba(20,24,34,0.56)' : 'rgba(255,255,255,0.7)'
  const raised = dark ? '#262626' : '#f5f5f5'
  const border = dark ? '#383838' : '#e5e5e5'
  const accent = dark ? '#e5e5e5' : '#262626'
  const soft = dark ? '#303030' : '#eeeeee'
  const shadow = dark ? '0 6px 24px rgba(0,0,0,0.12)' : '0 6px 24px rgba(35,53,42,0.04)'
  const palette: ThemeTokenOverrides = {
    color: {
      pageBackground: dark ? '#000000' : '#ffffff', surface,
      surfaceHover: dark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.42)',
      surfaceOverlay: dark ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.2)',
      mask: dark ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.22)',
      border: dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.58)', textPrimary: text, textSecondary: secondary,
      textMuted: muted, accent, success: dark ? '#86c8a1' : '#26734b',
      warning: dark ? '#d1b27c' : '#92713c', danger: dark ? '#dfa09a' : '#b05248',
    },
    font: { family: 'Aptos,"Segoe UI Variable","PingFang SC","Microsoft YaHei",sans-serif', weightHeading: '600' },
    radius: { small: '8px', medium: '12px', large: '20px' },
    effect: { shadowLow: '0 2px 8px rgba(25,42,32,0.04)', shadowMedium: shadow, shadowHigh: dark ? '0 20px 64px rgba(0,0,0,0.34), 0 4px 16px rgba(0,0,0,0.16)' : '0 20px 64px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.06)', blur: '32px' },
    bookmark: { cardBackground: surface, cardBorder: border, cardShadow: shadow, titleColor: text, descriptionColor: muted, iconBackground: dark ? '#141414' : '#ffffff', iconRadius: '16px' },
    widget: { background: surface, border, shadow, textColor: text, mutedText: muted, loadingColor: muted, retryBackground: raised, retryBorder: border, chartColors: ['#72977e', '#9aaca0', '#b4a788', '#758c92', '#b3867f'] },
    sidebar: { background: surface, border, hoverBackground: raised, activeBackground: soft, textColor: secondary, activeTextColor: accent },
    modal: { background: dark ? 'rgba(22,26,38,0.5)' : surface, overlay: 'rgba(0,0,0,0.28)', border, titleTextColor: text, contentTextColor: secondary },
    notification: { background: dark ? 'rgba(24,28,40,0.8)' : 'rgba(255,255,255,0.9)', titleTextColor: text, contentTextColor: secondary, boxShadow: shadow },
    icon: { defaultColor: secondary, activeColor: accent },
  }
  const base = completeTokens(dark ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS, palette)
  return freezeTokens(completeTokens(base, overrides))
}
