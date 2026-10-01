import type {
  ResolvedTheme,
  ResolvedThemeMode,
  ThemeContext,
  ThemeLoadIssue,
  ThemeSelection,
  ThemeSurface,
  ThemeVariants,
} from './types'
import type { ThemeContextValue } from './context'
import { reactive, ref } from 'vue'
import { DEFAULT_THEME_ID, THEME_ROOT_CLASS } from './constants'
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS, deepFreezeTokens } from './tokens'
import { DEFAULT_ICON_SET } from './icons'
import { DEFAULT_VARIANTS, resolveVariantCssVariables } from './variants'
import { tokensToCssVariables } from './cssVariables'
import { createThemeContextValue } from './context'
import { cloneJson } from './clone'

export { THEME_CONTEXT_KEY, defaultThemeContextValue, useTheme, useWidgetTheme } from './context'
export type { WidgetThemeValue } from './context'

/**
 * 主题运行时状态：双端共享，存储绑定由各端视图完成
 * （Web → panelConfig.theme 随 userConfig/set 同步；
 *   Extension → EXTENSION_APPEARANCE_KEY 本地保存）。
 */

export interface ThemeRuntimeState {
  /** 最近一次加载的原始选择；隔离场景保留未知主题原始数据。 */
  rawSelection: ThemeSelection | null
  quarantined: boolean
  issues: ThemeLoadIssue[]
  resolved: ResolvedTheme
  resolvedMode: ResolvedThemeMode
  surface: ThemeSurface
}

const systemDarkOverride = ref<boolean | null>(null)

function prefersDark(): boolean {
  if (systemDarkOverride.value !== null)
    return systemDarkOverride.value
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** 跟踪系统明暗的响应式状态：变化时驱动 auto 模式完整重解析。 */
const systemDark = ref(prefersDark())

/** 测试/SSR 注入点：显式设置系统明暗偏好；传 null 恢复自动探测。 */
export function setPreferredDark(value: boolean | null): void {
  systemDarkOverride.value = value
  systemDark.value = prefersDark()
}

export function getPreferredDark(): boolean {
  return systemDark.value
}

export function resolveThemeMode(mode: ThemeSelection['mode'], systemPrefersDark = systemDark.value): ResolvedThemeMode {
  if (mode === 'auto')
    return systemPrefersDark ? 'dark' : 'light'
  return mode
}

function fallbackResolved(resolvedMode: ResolvedThemeMode): ResolvedTheme {
  const base = resolvedMode === 'dark' ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS
  return {
    definition: {
      id: DEFAULT_THEME_ID,
      version: 1,
      meta: { name: 'Panel Next Default' },
      configSchema: { parse: value => (value ?? {}) as Record<string, never> },
      defaultConfig: () => ({}),
    },
    id: DEFAULT_THEME_ID,
    tokens: deepFreezeTokens(cloneJson(base)),
    icons: DEFAULT_ICON_SET,
    variants: DEFAULT_VARIANTS,
    config: {},
    overridesApplied: false,
    quarantined: true,
  }
}

const state = reactive<ThemeRuntimeState>({
  rawSelection: null,
  quarantined: false,
  issues: [],
  resolved: fallbackResolved('light'),
  resolvedMode: 'light',
  surface: typeof document !== 'undefined' && document.body?.dataset?.panelRuntime === 'extension' ? 'extension' : 'web',
})

/** 供测试与 SSR 重置。 */
export function resetThemeRuntime(surface: ThemeSurface = 'web'): void {
  state.rawSelection = null
  state.quarantined = false
  state.issues = []
  state.resolved = fallbackResolved('light')
  state.resolvedMode = 'light'
  state.surface = surface
}

/** 应用一次加载结果并刷新解析视图。 */
export function commitLoadResult(result: {
  resolved: ResolvedTheme
  selection: ThemeSelection | null
  quarantined: boolean
  issues: ThemeLoadIssue[]
}, surface: ThemeSurface = state.surface, resolvedMode?: ResolvedThemeMode): void {
  state.rawSelection = result.selection
  state.quarantined = result.quarantined
  state.issues = result.issues
  state.surface = surface
  state.resolvedMode = resolvedMode ?? resolveThemeMode(result.selection?.mode ?? 'auto')
  // Token 必须与 resolvedMode 同源（同一 loadResult），避免模式与实际配色脱节。
  // 解析异常时回退默认主题，禁止白屏。
  try {
    state.resolved = result.resolved
  }
  catch (error) {
    console.error('[Theme] Failed to apply resolved theme, falling back.', error)
    state.resolved = fallbackResolved(state.resolvedMode)
  }
}

/**
 * 系统明暗变化时更新跟踪值。
 * Provider 的 loadResult computed 依赖该 ref，会自动用新模式重新 resolve Token，
 * 因此这里只负责同步状态，不再手动改 resolvedMode（避免与 Token 脱节）。
 */
export function refreshSystemMode(systemPrefersDark = prefersDark()): boolean {
  const changed = systemDark.value !== systemPrefersDark
  systemDark.value = systemPrefersDark
  return changed
}

/**
 * 监听系统明暗变化（ThemeProvider 挂载期间）。
 * 返回清理函数；非浏览器环境返回空操作。
 */
export function watchSystemMode(): () => void {
  if (typeof matchMedia !== 'function')
    return () => {}
  const media = matchMedia('(prefers-color-scheme: dark)')
  const handler = (event: MediaQueryListEvent) => {
    refreshSystemMode(event.matches)
  }
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}

export function getThemeRuntimeState(): Readonly<ThemeRuntimeState> {
  return state
}

export function getActiveThemeId(): string {
  return state.quarantined ? DEFAULT_THEME_ID : (state.rawSelection?.themeId ?? DEFAULT_THEME_ID)
}


/** 创建跟随全局运行时状态的响应式上下文（无 Provider 场景的默认实现）。 */
export function createReactiveThemeContext(): ThemeContextValue {
  return createThemeContextValue(() => ({
    surface: state.surface,
    themeId: getActiveThemeId(),
    resolvedMode: state.resolvedMode,
    quarantined: state.quarantined,
    tokens: state.quarantined ? fallbackResolved(state.resolvedMode).tokens : state.resolved.tokens,
    icons: state.resolved.icons,
    variants: state.quarantined ? fallbackResolved(state.resolvedMode).variants : state.resolved.variants,
    selection: state.rawSelection,
  }))
}

/** Widget 专用切片：主题 ID、实际模式与只读 Widget Token。 */

export function buildThemeContext(surface: ThemeSurface): ThemeContext {
  return {
    surface,
    resolvedMode: state.resolvedMode,
    themeId: getActiveThemeId(),
    runtimeKind: surface,
  }
}

/**
 * 实时预览状态：设置后 ThemeProvider 渲染预览选择，但不提交持久化。
 * 取消或保存成功后必须清空（setThemePreview(null)）。
 */
const themePreviewSelection = ref<ThemeSelection | null>(null)

export function setThemePreview(selection: ThemeSelection | null): void {
  themePreviewSelection.value = selection
}

export function getThemePreview(): Readonly<ThemeSelection | null> {
  return themePreviewSelection.value
}

/**
 * Provider 视图：一次计算得到 CSS 变量、解析结果与注入上下文。
 * 抽成纯函数便于真实行为测试（auto 深色切换、预览覆盖等），
 * ThemeProvider 只是它的薄封装。
 */
export interface ThemeProviderView {
  loadResult: {
    resolved: ResolvedTheme
    selection: ThemeSelection | null
    quarantined: boolean
    issues: ThemeLoadIssue[]
  }
  resolvedMode: ResolvedThemeMode
  rootClass: string
  cssVariables: Record<string, string>
  variants: Readonly<ThemeVariants>
}

function asModeOf(raw: unknown): ThemeSelection['mode'] {
  const mode = (raw as { mode?: unknown } | null)?.mode
  return mode === 'light' || mode === 'dark' || mode === 'auto' ? mode : 'auto'
}

export function buildProviderResult(
  rawSelection: unknown,
  surface: ThemeSurface,
  registry: import('./registry').ThemeRegistry,
): ThemeProviderView {
  const mode = asModeOf(rawSelection)
  const resolvedMode = resolveThemeMode(mode)
  let loadResult
  try {
    loadResult = registry.loadSelection(rawSelection, mode, resolvedMode, surface)
  }
  catch (error) {
    // 解析异常回退默认主题，禁止白屏。
    console.error('[ThemeProvider] Theme resolution failed, using core.default.', error)
    loadResult = registry.loadSelection(null, 'auto', resolvedMode, surface)
  }
  const cssVariables = tokensToCssVariables(loadResult.resolved.tokens)
  if (cssVariables['--pn-effect-blur'] === 'none')
    cssVariables['--pn-effect-blur'] = '0px'
  const variants = loadResult.resolved.variants
  // Variant 是真实表现：把解析出的 Variant 映射为根容器上的 --pn-* 覆盖，
  // 与 token 变量合并后一次原子应用，保证 Bookmark/Widget/Sidebar/Search 形态实时变化。
  const mergedCssVariables = { ...cssVariables, ...resolveVariantCssVariables(variants) }
  return {
    loadResult,
    resolvedMode,
    rootClass: THEME_ROOT_CLASS,
    cssVariables: mergedCssVariables,
    variants,
  }
}
