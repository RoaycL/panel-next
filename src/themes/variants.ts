import type { BookmarkVariant, SearchVariant, SidebarVariant, ThemeVariants, WidgetVariant } from './types'

/**
 * Variant 规范（§13）：
 * - 只选择项目内置的稳定结构，不允许注入任意 HTML/CSS 选择器；
 * - 主题可声明默认 Variant，用户可单独覆盖；
 * - 未知 Variant 自动回退默认值；变更不影响业务数据与书签同步结构。
 */

export const DEFAULT_VARIANTS: Readonly<ThemeVariants> = Object.freeze({
  bookmark: 'glass' as BookmarkVariant,
  widget: 'glass' as WidgetVariant,
  sidebar: 'floating' as SidebarVariant,
  search: 'pill' as SearchVariant,
})

export const VARIANT_LABEL_KEYS: Record<keyof ThemeVariants, string> = {
  bookmark: 'theme.variants.bookmark',
  widget: 'theme.variants.widget',
  sidebar: 'theme.variants.sidebar',
  search: 'theme.variants.search',
}

export function coerceVariant<K extends keyof ThemeVariants>(key: K, value: unknown): ThemeVariants[K] {
  const allowed: Record<keyof ThemeVariants, readonly string[]> = {
    bookmark: ['glass', 'solid', 'minimal'],
    widget: ['glass', 'solid', 'borderless'],
    sidebar: ['floating', 'attached', 'minimal'],
    search: ['pill', 'box', 'underline'],
  }
  return (allowed[key] as readonly string[]).includes(value as string)
    ? value as ThemeVariants[K]
    : DEFAULT_VARIANTS[key]
}

/**
 * 将完整 Variant 集合映射为根容器上的 `--pn-*` CSS 变量覆盖。
 * 这是 Variant 「真实表现」的单一数据源：ThemeProvider 把它合并进 cssVariables 后
 * 直接作用于根节点，Bookmark / Widget / Sidebar / Search 渲染形态随 Variant 实时变化。
 * 语义契约：
 * - bookmark solid → surface 背景 + 边框；minimal → 去掉阴影与边框；
 * - widget borderless → 外壳透明、无边框、无阴影；solid → surface 背景 + 边框；
 * - sidebar minimal → 透明背景无边框；attached → surface 背景；
 * - search box → surface 背景 + 中等圆角；underline → 透明背景 + 无边框（由底边线补充）。
 * 与 variantVars.css 保持一致的取值（CSS 变量引用由运行时解析）。
 */
export function resolveVariantCssVariables(variants: Readonly<ThemeVariants>): Record<string, string> {
  const result: Record<string, string> = {}
  switch (variants.bookmark) {
    case 'solid':
      result['--pn-bookmark-card-background'] = 'var(--pn-color-surface)'
      result['--pn-bookmark-card-border'] = 'var(--pn-color-border)'
      break
    case 'minimal':
      result['--pn-bookmark-card-shadow'] = 'none'
      result['--pn-bookmark-card-border'] = 'transparent'
      break
    // glass 走默认值
  }
  switch (variants.widget) {
    case 'solid':
      result['--pn-widget-background'] = 'var(--pn-color-surface)'
      result['--pn-widget-border'] = 'var(--pn-color-border)'
      break
    case 'borderless':
      result['--pn-widget-background'] = 'transparent'
      result['--pn-widget-border'] = 'transparent'
      result['--pn-widget-shadow'] = 'none'
      break
    // glass 走默认值
  }
  switch (variants.sidebar) {
    case 'attached':
      result['--pn-sidebar-background'] = 'var(--pn-color-surface)'
      break
    case 'minimal':
      result['--pn-sidebar-background'] = 'transparent'
      result['--pn-sidebar-border'] = 'transparent'
      break
    // floating 走默认值
  }
  switch (variants.search) {
    case 'box':
      result['--pn-search-radius'] = 'var(--pn-radius-medium)'
      result['--pn-search-background'] = 'var(--pn-color-surface)'
      result['--pn-search-border'] = 'var(--pn-color-border)'
      break
    case 'underline':
      result['--pn-search-radius'] = '0'
      result['--pn-search-background'] = 'transparent'
      result['--pn-search-border'] = 'transparent'
      result['--pn-search-underline'] = 'var(--pn-color-accent)'
      break
    // pill 走默认值
  }
  return result
}
