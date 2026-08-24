import type { ThemeIconName, ThemeIconSet } from './types'
import { THEME_ICON_NAMES } from './types'

/**
 * 默认图标包（core.default）：语义名 → 本地 SVG 雪碧图资源名。
 * 全部图标随应用本地打包，禁止远程脚本；单色 SVG 使用 currentColor。
 */
export const DEFAULT_ICON_SET: Readonly<ThemeIconSet> = Object.freeze({
  settings: 'panel-next-settings',
  close: 'line-md-close-small',
  add: 'typcn-plus',
  refresh: 'material-symbols-sync',
  edit: 'basil-edit-solid',
  delete: 'material-symbols-delete',
  search: 'iconamoon-search-fill',
  save: 'material-symbols-save',
  check: 'material-symbols-favorite',
  warning: 'mdi-information-box-outline',
  info: 'lucide-info',
  more: 'mingcute-more-1-fill',
  drag: 'ri-drag-drop-line',
  toTop: 'icon-park-outline-to-top',
  externalLink: 'mdi-open-in-new',
  user: 'ph-user-bold',
  logout: 'tabler-logout',
  upload: 'tabler-file-upload',
  download: 'fa6-solid-file-import',
  copy: 'ion-copy',
  theme: 'ion-color-palette-outline',
  wallpaper: 'material-symbols-wallpaper',
  language: 'ion-language',
  sync: 'material-symbols-sync',
  folder: 'material-symbols-folder-outline',
  dashboard: 'majesticons-applications',
  networkWired: 'mdi-lan',
  networkWireless: 'mdi-wan',
  eye: 'panel-next-visibility',
  eyeOff: 'panel-next-visibility-off',
  chevronRight: 'mdi-chevron-right',
  darkMode: 'material-symbols-dark-mode-outline-rounded',
  lightMode: 'material-symbols-light-mode-outline-rounded',
})

/** 校验图标映射键是否全部为受支持的语义名。 */
export function validateIconSet(icons: Partial<ThemeIconSet>): string | null {
  for (const key of Object.keys(icons)) {
    if (!THEME_ICON_NAMES.includes(key as ThemeIconName))
      return `unknown semantic icon "${key}"`
    const value = icons[key as ThemeIconName]
    if (typeof value !== 'string' || !value || value.length > 96)
      return `invalid icon resource for "${key}"`
  }
  return null
}

/** 合并图标包：缺失的语义图标回退到默认包。 */
export function completeIconSet(overrides?: Partial<ThemeIconSet> | null): Readonly<ThemeIconSet> {
  if (!overrides)
    return DEFAULT_ICON_SET
  const merged = { ...DEFAULT_ICON_SET }
  for (const key of THEME_ICON_NAMES) {
    const value = overrides[key]
    if (typeof value === 'string' && value && value.length <= 96)
      merged[key] = value
  }
  return Object.freeze(merged)
}

/* ------------------------- 图标资源名安全解析 ------------------------- */

export type ThemeIconResource =
  | { kind: 'sprite', name: string }
  | { kind: 'iconify', name: string }

/**
 * 会被当作网络/执行资源预加载的「伪 Iconify」前缀，一律拒绝。
 * Iconify 名称形如 `prefix:name`；任何把协议伪装成 prefix 的值（javascript:、
 * data:、http(s):、vbscript: 等）都不能进入图标系统。
 */
const DANGEROUS_ICONIFY_PREFIXES = new Set([
  'javascript', 'data', 'http', 'https', 'vbscript', 'file', 'blob', 'about', 'chrome',
])

/** 本地雪碧图安全命名：小写字母数字与连字符（随应用打包，离线可用）。 */
export function isLocalSpriteName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value)
}

/** Iconify 命名：`prefix:name`，prefix 与 name 均为小写字母数字与连字符；
 *  拒绝任何危险 scheme 伪装成 prefix。 */
export function isIconifyName(value: string): boolean {
  const index = value.indexOf(':')
  if (index <= 0 || index !== value.lastIndexOf(':'))
    return false
  const prefix = value.slice(0, index).toLowerCase()
  if (DANGEROUS_ICONIFY_PREFIXES.has(prefix))
    return false
  return /^[a-z0-9-]+$/.test(prefix)
    && /^[a-z0-9-]+$/.test(value.slice(index + 1))
}

/**
 * 将图标包的资源值解析为受控的渲染目标。
 * - 优先本地雪碧图名；
 * - Iconify 名称仅在 allowIconifyOnline !== false 时接受。Extension 表面应传
 *   allowIconifyOnline:false，强制只使用随包资源，避免因主题图标产生外部请求。
 * - 危险/非法值返回 null 由调用方回退默认包。
 */
export function resolveThemeIconResource(
  value: unknown,
  options: { allowIconifyOnline?: boolean } = {},
): ThemeIconResource | null {
  if (typeof value !== 'string' || !value || value.length > 96)
    return null
  if (isLocalSpriteName(value))
    return { kind: 'sprite', name: value }
  if (options.allowIconifyOnline !== false && isIconifyName(value))
    return { kind: 'iconify', name: value }
  return null
}
