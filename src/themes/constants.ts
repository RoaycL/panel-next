/**
 * Theme SDK 常量。
 * 主题 ID 规则：小写字母/数字开头，仅小写字母、数字、点、连字符，1~64 字符，
 * 推荐 `<vendor>.<name>` 命名空间；`core.` 前缀保留给内置主题。
 */
export const THEME_ID_PATTERN = /^[a-z\d][a-z\d.-]{0,63}$/
export const THEME_ICON_PACK_ID_PATTERN = /^[a-z\d][a-z\d.-]{0,63}$/

/** 图标包 ID 保留前缀：内置默认包。 */
export const RESERVED_ICON_PACK_PREFIX = 'core.'

export const DEFAULT_THEME_ID = 'core.default'
export const DEFAULT_ICON_PACK_ID = 'core.default'

export const BOOKMARK_VARIANTS: readonly string[] = ['glass', 'solid', 'minimal']
export const WIDGET_VARIANTS: readonly string[] = ['glass', 'solid', 'borderless']
export const SIDEBAR_VARIANTS: readonly string[] = ['floating', 'attached', 'minimal']
export const SEARCH_VARIANTS: readonly string[] = ['pill', 'box', 'underline']

/** CSS 变量统一使用 --pn- 前缀，避免污染宿主页面。 */
export const CSS_VARIABLE_PREFIX = '--pn-'

/** 主题根容器 class。变量只应用到该容器内部。 */
export const THEME_ROOT_CLASS = 'pn-theme-root'
