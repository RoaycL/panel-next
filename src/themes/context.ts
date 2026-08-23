import type { InjectionKey } from 'vue'
import type {
  ResolvedThemeMode,
  ThemeIconSet,
  ThemeSelection,
  ThemeSurface,
  ThemeTokens,
  ThemeVariants,
  WidgetVariant,
} from './types'
import { inject, reactive } from 'vue'
import { DEFAULT_THEME_ID } from './constants'
import { DEFAULT_LIGHT_TOKENS, deepFreezeTokens } from './tokens'
import { DEFAULT_ICON_SET } from './icons'
import { DEFAULT_VARIANTS } from './variants'

/**
 * 主题上下文的叶子实现：只依赖 types/constants/tokens/icons/variants，
 * 不引入 storage/registry/runtime 等带副作用或重依赖的模块。
 *
 * 这样 WidgetHost 等基础组件可以安全导入 useTheme()，
 * 而不会形成 widgets ↔ themes 的运行时循环依赖
 * （themes/index → storage → runtime/extensionAppearance → widgets → WidgetHost）。
 */

export interface ThemeContextValue {
  surface: ThemeSurface
  themeId: string
  resolvedMode: ResolvedThemeMode
  quarantined: boolean
  tokens: Readonly<ThemeTokens>
  icons: Readonly<ThemeIconSet>
  variants: Readonly<ThemeVariants>
  selection: Readonly<ThemeSelection> | null
}

export const THEME_CONTEXT_KEY: InjectionKey<ThemeContextValue> = Symbol('panel-next-theme-context')

/** 组件层上下文缺失时自动回退 core.default。嵌套 Token 与图表色板均不可修改。 */
export const defaultThemeContextValue: Readonly<ThemeContextValue> = deepFreezeTokens({
  surface: 'web',
  themeId: DEFAULT_THEME_ID,
  resolvedMode: 'light',
  quarantined: true,
  tokens: DEFAULT_LIGHT_TOKENS,
  icons: DEFAULT_ICON_SET,
  variants: DEFAULT_VARIANTS,
  selection: null,
} as ThemeContextValue)

/** 读取注入的主题上下文；无 Provider（独立预览/测试）时回退默认主题。 */
export function useTheme(): ThemeContextValue {
  return inject(THEME_CONTEXT_KEY, defaultThemeContextValue)
}

/** Widget 专用切片：主题 ID、实际模式和只读 Widget Token。 */
export interface WidgetThemeValue {
  themeId: string
  resolvedMode: ResolvedThemeMode
  variant: WidgetVariant
  tokens: Readonly<ThemeContextValue['tokens']['widget']>
  chartColors: readonly string[]
}

export function createDefaultWidgetThemeValue(): WidgetThemeValue {
  return {
    themeId: DEFAULT_THEME_ID,
    resolvedMode: 'light',
    variant: DEFAULT_VARIANTS.widget,
    tokens: DEFAULT_LIGHT_TOKENS.widget,
    chartColors: DEFAULT_LIGHT_TOKENS.widget.chartColors,
  }
}


export function useWidgetTheme(): WidgetThemeValue {
  const context = useTheme()
  return reactive({
    get themeId() {
      return context.themeId
    },
    get resolvedMode() {
      return context.resolvedMode
    },
    get variant() {
      return context.variants.widget
    },
    get tokens() {
      return context.tokens.widget
    },
    get chartColors() {
      return context.tokens.widget.chartColors
    },
  })
}

/**
 * 创建由外部数据源驱动的响应式上下文。
 * ThemeProvider 传入「预览感知」的读取器，使图标/Variant/themeId 在预览期完整生效；
 * 其他调用方可传入全局运行时状态的读取器。
 */
export function createThemeContextValue(source: () => ThemeContextValue): ThemeContextValue {
  return reactive({
    get surface() {
      return source().surface
    },
    get themeId() {
      return source().themeId
    },
    get resolvedMode() {
      return source().resolvedMode
    },
    get quarantined() {
      return source().quarantined
    },
    get tokens() {
      return source().tokens
    },
    get icons() {
      return source().icons
    },
    get variants() {
      return source().variants
    },
    get selection() {
      return source().selection
    },
  })
}
