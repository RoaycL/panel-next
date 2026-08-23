import type { ThemeMode, ThemeSelection, ThemeSurface } from './types'
import { DEFAULT_THEME_ID } from './constants'
import { THEME_SELECTION_SCHEMA_VERSION } from './types'
import { validateThemeWireSelection } from './schema'

/**
 * 旧外观配置兼容适配器。
 *
 * 产品边界：分组和书签双端共享；样式、主题、组件布局双端分别保存。
 * 旧字段（backgroundImageSrc/backgroundBlur/backgroundMaskNumber/iconStyle/
 * iconTextColor/clockColor 等）继续由现有组件直接读取，本阶段不删除；
 * 首次进入新主题体系时自动补一个默认 ThemeSelection，保证视觉零漂移。
 */

const LEGACY_DEFAULT_ICON_TEXT_COLOR = '#ffffff'

/** 从应用明暗偏好生成默认选择。 */
export function createDefaultSelection(mode: ThemeMode): ThemeSelection {
  return {
    schemaVersion: THEME_SELECTION_SCHEMA_VERSION,
    themeId: DEFAULT_THEME_ID,
    themeVersion: 1,
    mode,
    config: {},
    overrides: {},
    variants: {},
    iconPackId: undefined,
  }
}

/**
 * 从旧 panelConfig 生成初始主题选择：
 * - 无自定义颜色时返回纯默认选择；
 * - 自定义过图标文字颜色时映射为 icon Token 覆盖，保留用户个性化；
 * - 壁纸类字段不迁移，仍由旧字段驱动（避免双份真相）。
 */
export function selectionFromLegacy(panelConfig: Partial<Panel.panelConfig> | null | undefined, mode: ThemeMode): ThemeSelection {
  const base = createDefaultSelection(mode)
  const iconTextColor = panelConfig?.iconTextColor
  const hasCustomIconColor = typeof iconTextColor === 'string'
    && iconTextColor.length > 0
    && iconTextColor !== LEGACY_DEFAULT_ICON_TEXT_COLOR
  if (!hasCustomIconColor)
    return base
  return {
    ...base,
    overrides: {
      icon: { defaultColor: iconTextColor },
    },
  }
}

/**
 * 判断是否需要为旧配置补充默认主题选择。
 * 合法但未知的主题（未来版本）同样返回 false：隔离逻辑负责保留原数据。
 */
export function needsThemeSelection(panelConfig: Partial<Panel.panelConfig> | null | undefined): boolean {
  return !panelConfig || !panelConfig.theme
}

/**
 * 启动迁移：为缺少 theme 字段的配置补默认选择（含 iconTextColor 映射）。
 * 返回新对象；无需变更时返回原引用（changed=false）。
 */
export function ensureThemeSelection(
  config: Panel.panelConfig,
  mode: ThemeMode,
): { config: Panel.panelConfig, changed: boolean } {
  if (!needsThemeSelection(config))
    return { config, changed: false }
  return {
    config: { ...config, theme: selectionFromLegacy(config, mode) },
    changed: true,
  }
}

/**
 * 安全清理：结构非法的主题选择直接从配置中剥离，
 * 防止损坏数据反复进入加载/隔离流程。结构合法（含未知主题）一律保留。
 */
export function stripInvalidTheme(config: Panel.panelConfig): { config: Panel.panelConfig, changed: boolean } {
  const theme = (config as Partial<Panel.panelConfig>).theme
  if (!theme)
    return { config, changed: false }
  if (validateThemeWireSelection(theme) === null)
    return { config, changed: false }
  const cleaned: Panel.panelConfig = { ...config }
  delete cleaned.theme
  return { config: cleaned, changed: true }
}

export interface PanelAppearanceResult {
  config: Panel.panelConfig
  changed: boolean
  issues: string[]
  /**
   * Extension-only：当以 writeBack 方式应用配置时，回写 EXTENSION_APPEARANCE_KEY 的
   * 可等待 Promise（resolve=true 表示持久化成功，false 表示失败）。调用方可 await
   * 确认持久化完成，而无需依赖 fire-and-forget 的 void 调用。
   */
  writeBack?: Promise<boolean>
}

/** 迁移基础结构合法性的辅助：非对象配置直接用默认选择替换。 */
function defaultAppearanceConfig(mode: ThemeMode): Panel.panelConfig {
  return { theme: createDefaultSelection(mode) } as Panel.panelConfig
}

/**
 * 统一外观配置入口。所有端（Web 本地恢复 / userConfig-get / bootstrap / 同步冲突刷新，
 * Extension 本地 appearance / bootstrap / storage.onChanged / 账号切换重载）都应复用本函数，
 * 保证 theme 字段的「结构性校验 → 迁移 → 补默认」语义完全一致，避免各入口各自实现产生漂移。
 *
 * 处理顺序（本函数即契约；scripts/validate-theme-registry.mjs 的 B9b 用例校验它）：
 * 1. 校验 panelConfig 基础结构（非对象 → 用默认选择并记录 issue）；
 * 2. 剥离结构非法 theme 并补 core.default（stripInvalidTheme）；
 * 3. 必要旧字段迁移（iconTextColor → icon Token override，由 ensureThemeSelection 完成）；
 * 4. 可选的品牌迁移（由调用方注入 migrateBranding，作为最后一步、默认不重复处理）。
 *
 * @param config  原始 panelConfig（可为 null / 非对象，此时返回默认选择）。
 * @param surface 当前运行端（'web' | 'extension'）。【当前不用于删除/过滤主题】——
 *   结构合法的未知/未来/表面不兼容主题一律保留（surface 兼容性由运行时/UI 层
 *   isQuarantinedSelection 处理，这里刻意不删）；该参数保留为 API 契约，
 *   供未来的端特定默认值/迁移使用。调用方应始终传入合法表面。
 * @param mode    明暗偏好（'light' | 'dark' | 'auto'），用于补默认选择。
 * @param migrateBranding 可选的品牌迁移函数；注入重复调用会导致双份真相。
 *
 * 约束：
 * - 结构合法的未知/未来主题必须保留，不能误删（stripInvalidTheme 只删结构非法者）；
 * - 结构非法 theme 安全删除并补 core.default；
 * - 自动补默认主题只改 theme 字段，不覆盖其他 panelConfig 字段；
 * - 幂等：对已迁移配置重复调用返回 changed=false。
 */
export function preparePanelAppearance(
  config: Panel.panelConfig | null | undefined,
  surface: ThemeSurface,
  mode: ThemeMode,
  migrateBranding?: (config: Panel.panelConfig) => Panel.panelConfig,
): PanelAppearanceResult {
  const issues: string[] = []
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    issues.push('panel config is not an object; using default theme selection')
    return { config: defaultAppearanceConfig(mode), changed: true, issues }
  }

  let result = config
  let changed = false

  // 剥离结构非法 theme：只删非法主题，保留结构合法（含未知/未来/表面不兼容）的数据。
  const stripped = stripInvalidTheme(result)
  if (stripped.changed) {
    result = stripped.config
    changed = true
    issues.push('dropped structurally invalid theme selection')
  }

  // 补默认 theme：不覆盖其他 panelConfig 字段（含 iconTextColor → icon Token 迁移）。
  const ensured = ensureThemeSelection(result, mode)
  if (ensured.changed) {
    result = ensured.config
    changed = true
  }

  // 品牌迁移（可选，由调用方注入，避免双份真相）：作为最后一步，作用于已规范化配置。
  if (migrateBranding) {
    const migrated = migrateBranding(result)
    if (migrated !== result) {
      result = migrated
      changed = true
    }
  }

  return { config: result, changed, issues }
}
