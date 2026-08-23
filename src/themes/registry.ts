import type {
  ResolvedTheme,
  ResolvedThemeMode,
  ThemeDefinition,
  ThemeLoadIssue,
  ThemeLoadResult,
  ThemeSelection,
  ThemeSurface,
  ThemeTokenOverrides,
  ThemeVariants,
} from './types'
import { defaultTheme } from './builtins/default'
import {
  DEFAULT_DARK_TOKENS,
  DEFAULT_LIGHT_TOKENS,
  completeTokens,
  deepMergeTokens,
  freezeTokens,
} from './tokens'
import { completeIconSet, validateIconSet, DEFAULT_ICON_SET } from './icons'
import { normalizeThemeSelection, validateThemeWireSelection, validateVariantOverrides, jsonSize } from './schema'
import { BOOKMARK_VARIANTS, SEARCH_VARIANTS, SIDEBAR_VARIANTS, THEME_ID_PATTERN, WIDGET_VARIANTS } from './constants'
import { MAX_THEME_CONFIG_BYTES, RESERVED_THEME_ID_PREFIX, THEME_SELECTION_SCHEMA_VERSION } from './types'
import { tokensToCssVariables } from './cssVariables'
import { coerceVariant, DEFAULT_VARIANTS } from './variants'

const DEFAULT_VARIANTS_SNAPSHOT = Object.freeze({ ...DEFAULT_VARIANTS })

/** 内置默认 Variant：主题未声明或声明非法时的最终回退值。 */
const FALLBACK_VARIANTS = { ...DEFAULT_VARIANTS_SNAPSHOT }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateSurfaces(surfaces: unknown): string | null {
  if (!Array.isArray(surfaces))
    return 'surfaces must be an array'
  for (const surface of surfaces) {
    if (surface !== 'web' && surface !== 'extension')
      return `invalid surface "${String(surface)}"`
  }
  return null
}

function validateVariantsDeclaration(variants: unknown): string | null {
  if (!isRecord(variants))
    return 'variants must be an object'
  const known: Record<string, readonly string[]> = {
    bookmark: BOOKMARK_VARIANTS,
    widget: WIDGET_VARIANTS,
    sidebar: SIDEBAR_VARIANTS,
    search: SEARCH_VARIANTS,
  }
  for (const [key, value] of Object.entries(variants)) {
    const allowed = known[key]
    if (!allowed || typeof value !== 'string' || !allowed.includes(value))
      return `invalid variant declaration "${key}"`
  }
  return null
}

export class ThemeRegistry {
  private readonly definitions = new Map<string, ThemeDefinition<any>>()
  /** 用户可选择的图标包：语义名 → 本地资源名 / Iconify 名称。 */
  private readonly iconPacks = new Map<string, Readonly<Record<string, string>>>()

  constructor() {
    this.iconPacks.set('core.default', DEFAULT_ICON_SET)
  }

  /** 注册图标包；ID 规则与主题一致，`core.` 前缀保留。 */
  registerIconPack(id: string, icons: Record<string, string>, options: { builtin?: boolean } = {}): this {
    if (!THEME_ID_PATTERN.test(id))
      throw new Error(`Invalid icon pack id "${id}".`)
    if (id.startsWith(RESERVED_THEME_ID_PREFIX) && options.builtin !== true)
      throw new Error(`Icon pack id "${id}" uses the reserved prefix.`)
    if (this.iconPacks.has(id))
      throw new Error(`Icon pack "${id}" is already registered.`)
    const iconError = validateIconSet(icons)
    if (iconError)
      throw new Error(`Invalid icon pack "${id}": ${iconError}`)
    this.iconPacks.set(id, Object.freeze({ ...icons }))
    return this
  }

  getIconPack(id: string): Readonly<Record<string, string>> | undefined {
    return this.iconPacks.get(id)
  }

  listIconPacks(): Array<{ id: string, name: string }> {
    return [...this.iconPacks.keys()].map(id => ({
      id,
      name: id === 'core.default' ? 'core.default' : id,
    }))
  }

  /** 注册主题；重复 ID 或任何契约违规都会抛错。 */
  register<T>(definition: ThemeDefinition<T>, options: { builtin?: boolean } = {}): this {
    if (this.definitions.has(definition.id))
      throw new Error(`Theme "${definition.id}" is already registered.`)
    const violation = this.validateDefinition(definition, options.builtin === true)
    if (violation)
      throw new Error(`Invalid theme definition "${definition.id}": ${violation}`)
    // 必须能同步：defaultConfig 解析结果不能超限，且用它构造的完整 ThemeSelection
    // 必须通过前后端 wire 契约（防止「注册成功但永远无法同步」的主题）。
    try {
      const parsedDefaults = definition.configSchema.parse(definition.defaultConfig())
      if (jsonSize(parsedDefaults) > MAX_THEME_CONFIG_BYTES)
        throw new Error(`defaultConfig exceeds ${MAX_THEME_CONFIG_BYTES} bytes`)
      const probe: ThemeSelection = {
        schemaVersion: THEME_SELECTION_SCHEMA_VERSION,
        themeId: definition.id,
        themeVersion: definition.version,
        mode: 'auto',
        config: parsedDefaults,
        overrides: {},
        variants: {},
        iconPackId: undefined,
      }
      const wireViolation = validateThemeWireSelection(probe)
      if (wireViolation)
        throw new Error(`defaultConfig produces a selection that violates the wire contract: ${wireViolation}`)
    }
    catch (error) {
      throw new Error(`Invalid theme definition "${definition.id}": ${error instanceof Error ? error.message : String(error)}`)
    }
    this.definitions.set(definition.id, definition as ThemeDefinition<any>)
    return this
  }

  get(id: string): ThemeDefinition<any> | undefined {
    return this.definitions.get(id)
  }

  /** 按 surface 过滤的主题列表（surfaces 缺省表示双端可用）。 */
  list(surface?: ThemeSurface): Array<ThemeDefinition<any>> {
    return [...this.definitions.values()].filter((definition) => {
      if (!definition.surfaces?.length)
        return true
      return surface ? definition.surfaces.includes(surface) : true
    })
  }

  /** 为已注册主题创建全新选择信封。产物必须能通过前后端 wire 契约。 */
  createSelection(themeId: string, mode: ThemeSelection['mode'] = 'auto'): ThemeSelection {
    const definition = this.definitions.get(themeId)
    if (!definition)
      throw new Error(`Unknown theme "${themeId}".`)
    const selection: ThemeSelection = {
      schemaVersion: THEME_SELECTION_SCHEMA_VERSION,
      themeId,
      themeVersion: definition.version,
      mode,
      config: definition.defaultConfig(),
      overrides: {},
      variants: {},
      iconPackId: undefined,
    }
    // 注册后必须能立即同步：产出必须通过 wire 契约（含 config/overrides/信封字节上限），
    // 且配置能通过 theme 自身 schema（剥离未知字段、补默认值）。
    const violation = validateThemeWireSelection(selection)
    if (violation)
      throw new Error(`createSelection for "${themeId}" violates the wire contract: ${violation}`)
    try {
      definition.configSchema.parse(selection.config ?? {})
    }
    catch (error) {
      throw new Error(`createSelection for "${themeId}" produced config rejected by its schema: ${error instanceof Error ? error.message : String(error)}`)
    }
    return selection
  }

  /**
   * 连续版本迁移：从 selection.themeVersion 逐步执行到当前版本。
   * 缺失任一迁移步骤时抛错，由 loadSelection 转为隔离。
   */
  migrate(selection: Record<string, unknown>): { selection: ThemeSelection; migrated: boolean } {
    const definition = this.definitions.get(selection.themeId as string)
    if (!definition)
      throw new Error(`Unknown theme "${selection.themeId}".`)
    let version = selection.themeVersion as number
    let config: unknown = selection.config
    let migrated = false
    while (version < definition.version) {
      const migration = definition.migrations?.[version]
      if (!migration)
        throw new Error(`Missing theme migration ${version} -> ${version + 1}.`)
      config = migration(config)
      version++
      migrated = true
    }
    return {
      selection: { ...normalizeThemeSelection({ ...selection, themeVersion: version, config }) },
      migrated,
    }
  }

  /**
   * 加载选择信封：
   * - 结构违规 → 丢弃并回退默认选择（preserved=false）；
   * - 未知主题 / 未来版本 / 缺失迁移 → 隔离保留原始数据，UI 使用默认主题；
   * - surface 不兼容（web-only 主题在 extension 渲染，或反之）→ 隔离保留原始数据；
   * - 正常 → 迁移并解析出完整 Token。
   */
  loadSelection(
    raw: unknown,
    mode: ThemeSelection['mode'] = 'auto',
    resolvedMode: ResolvedThemeMode = mode === 'dark' ? 'dark' : 'light',
    surface?: ThemeSurface,
  ): ThemeLoadResult {
    const issues: ThemeLoadIssue[] = []
    if (raw === undefined || raw === null) {
      return {
        resolved: this.resolveFallback(mode, resolvedMode),
        selection: null,
        quarantined: false,
        issues,
      }
    }
    const structuralViolation = validateThemeWireSelection(raw)
    if (structuralViolation) {
      issues.push({ reason: structuralViolation, preserved: false })
      return {
        resolved: this.resolveFallback(mode, resolvedMode),
        selection: null,
        quarantined: false,
        issues,
      }
    }

    const candidate = raw as Record<string, unknown>
    const definition = this.definitions.get(candidate.themeId as string)

    if (!definition) {
      // 未知但结构合法的主题：保留原始数据，UI 回退默认。
      issues.push({ reason: `unknown theme "${candidate.themeId}"`, preserved: true })
      return {
        resolved: this.resolveFallback(mode, resolvedMode),
        selection: normalizeThemeSelection(raw),
        quarantined: true,
        issues,
      }
    }

    // surface 契约：web-only 主题不能在 extension 渲染，反之亦然。
    // 不兼容时保留原始 ThemeSelection，UI 回退 core.default，并产生可读 issue。
    if (surface && definition.surfaces?.length && !definition.surfaces.includes(surface)) {
      const readableReason = `theme "${definition.id}" is not available on surface "${surface}"`
      issues.push({ reason: readableReason, preserved: true })
      return {
        resolved: this.resolveFallback(mode, resolvedMode),
        selection: normalizeThemeSelection(raw),
        quarantined: true,
        issues,
      }
    }

    if ((candidate.themeVersion as number) > definition.version) {
      issues.push({ reason: `future theme version ${candidate.themeVersion} > ${definition.version}`, preserved: true })
      return {
        resolved: this.resolveFallback(mode, resolvedMode),
        selection: normalizeThemeSelection(raw),
        quarantined: true,
        issues,
      }
    }

    try {
      const { selection, migrated } = this.migrate(candidate)
      // 迁移后的完整选择必须仍满足 wire 契约（config/overrides/信封字节上限等），
      // 否则迁移本身「修复」了旧版本却产生超限数据，仍属隔离。
      const migratedViolation = validateThemeWireSelection(selection)
      if (migratedViolation)
        throw new Error(`Migrated theme selection violates wire contract: ${migratedViolation}`)
      const resolved = this.resolve(selection, resolvedMode)
      if (migrated)
        issues.push({ reason: `migrated from version ${(candidate.themeVersion as number)}`, preserved: true })
      return { resolved, selection, quarantined: false, issues }
    }
    catch (error) {
      // 缺失迁移或迁移/解析失败：隔离保留，禁止卡死面板保存。
      issues.push({
        reason: error instanceof Error ? error.message : String(error),
        preserved: true,
      })
      return {
        resolved: this.resolveFallback(mode, resolvedMode),
        selection: normalizeThemeSelection(raw),
        quarantined: true,
        issues,
      }
    }
  }

  /** 解析为完整只读 Token / 图标 / Variant 视图。 */
  resolve(selection: ThemeSelection, resolvedMode: ResolvedThemeMode = 'light'): ResolvedTheme {
    const definition = this.definitions.get(selection.themeId)
    if (!definition)
      throw new Error(`Unknown theme "${selection.themeId}".`)
    const config = definition.configSchema.parse(selection.config ?? {})
    const base = resolvedMode === 'dark' ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS
    const declared = resolvedMode === 'dark'
      ? definition.tokens?.dark ?? definition.tokens?.light
      : definition.tokens?.light
    // 三层覆盖深度合并：主题声明 ← 用户 overrides ← 动态钩子，
    // 保证用户只改 color.accent 时不会丢掉主题声明的其他 color 键。
    let merged: Partial<ThemeTokenOverrides> = deepMergeTokens({}, declared ?? {})
    merged = deepMergeTokens(merged, selection.overrides ?? {}) as Partial<ThemeTokenOverrides>
    const dynamic = definition.resolveTokens?.(config, resolvedMode)
    if (dynamic)
      merged = deepMergeTokens(merged, dynamic) as Partial<ThemeTokenOverrides>
    const completed = freezeTokens(completeTokens(base, merged))
    // 输出前先走一遍严格 CSS 值校验，失败即抛错由上层回退默认主题。
    tokensToCssVariables(completed)
    return {
      definition,
      id: definition.id,
      tokens: completed,
      icons: completeIconSet({
        ...definition.icons,
        ...((selection.iconPackId && this.iconPacks.get(selection.iconPackId)) || {}),
      }),
      variants: this.resolveVariants(definition, selection),
      config,
      overridesApplied: Object.keys(merged).length > 0,
      quarantined: false,
    }
  }

  /**
   * 序列化前的出口校验：
   * - 已注册主题的选择违反契约 → 抛错阻止保存；
   * - 隔离数据仅要求结构合法，违规时返回 null 由调用方丢弃并告警。
   *
   * 对已注册主题，本方法会执行完整连续迁移到当前版本、通过当前主题
   * configSchema 解析剥离未知字段并补齐默认值、再对迁移结果整体重新执行
   * wire 契约校验（含 config / overrides / 信封字节上限）。返回的始终是
   * 「当前版本 + 已解析配置」的 ThemeSelection，绝不允许返回迁移前旧版本。
   */
  serialize(selection: unknown, options: { quarantined?: boolean } = {}): ThemeSelection | null {
    const structuralViolation = validateThemeWireSelection(selection)
    if (structuralViolation) {
      if (options.quarantined) {
        console.warn(`[ThemeRegistry] Dropping invalid quarantined theme selection: ${structuralViolation}`)
        return null
      }
      throw new Error(structuralViolation)
    }
    const candidate = selection as Record<string, unknown>
    const definition = this.definitions.get(candidate.themeId as string)
    if (!definition)
      return normalizeThemeSelection(candidate)
    if (options.quarantined)
      return normalizeThemeSelection(candidate)
    // 正常选择：版本必须能被当前定义处理。
    if ((candidate.themeVersion as number) > definition.version)
      throw new Error(`Theme "${candidate.themeId}" version exceeds the registered version.`)
    try {
      // 1) 连续迁移到当前版本（缺步骤会抛错）。
      const migrated = this.migrate(candidate).selection
      // 2) 通过当前主题 schema 解析剥离未知字段、补齐默认值。
      const parsedConfig = definition.configSchema.parse(migrated.config ?? {})
      // 3) 将解析后的配置写回迁移结果。
      const next: ThemeSelection = { ...migrated, config: parsedConfig }
      // 4) 对完整迁移结果重新执行 wire 契约校验（含 config/overrides/信封字节上限）。
      const violation = validateThemeWireSelection(next)
      if (violation)
        throw new Error(violation)
      return next
    }
    catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error))
    }
  }

  /** 结构合法但无法在当前端解析（未知/未来/缺迁移/配置或 Token 违规/surface 不兼容）时为 true。
   *  复用完整加载语义：迁移、config Schema 解析、Token / Variant / 图标包解析、
   *  CSS Token 严格值校验与 surface 契约任一步失败均视为隔离。 */
  isQuarantinedSelection(raw: unknown, surface?: ThemeSurface): boolean {
    if (raw === undefined || raw === null)
      return false
    return this.loadSelection(raw, 'auto', 'light', surface).quarantined
  }

  private resolveVariants(definition: ThemeDefinition<any>, selection: ThemeSelection): Readonly<ThemeVariants> {
    const declared: Record<string, string> = { ...FALLBACK_VARIANTS }
    if (isRecord(definition.variants)) {
      for (const key of Object.keys(FALLBACK_VARIANTS))
        declared[key] = coerceVariant(key as keyof ThemeVariants, (definition.variants as Record<string, unknown>)[key])
    }
    if (isRecord(selection.variants)) {
      for (const key of Object.keys(FALLBACK_VARIANTS))
        declared[key] = coerceVariant(key as keyof ThemeVariants, (selection.variants as Record<string, unknown>)[key])
    }
    return Object.freeze(declared) as Readonly<ThemeVariants>
  }

  private resolveFallback(mode: ThemeSelection['mode'], resolvedMode: ResolvedThemeMode = 'light'): ResolvedTheme {
    const selection = this.createSelection('core.default', mode)
    const resolved = this.resolve(selection, resolvedMode)
    return { ...resolved, quarantined: true }
  }

  private validateDefinition(definition: ThemeDefinition<any>, builtin: boolean): string | null {
    if (typeof definition.id !== 'string' || !THEME_ID_PATTERN.test(definition.id))
      return 'invalid theme id'
    if (definition.id.startsWith(RESERVED_THEME_ID_PREFIX) && !builtin)
      return `"${RESERVED_THEME_ID_PREFIX}" prefix is reserved for built-in themes`
    if (!Number.isSafeInteger(definition.version) || definition.version < 1)
      return 'theme version must be a positive safe integer'
    if (!isRecord(definition.meta) || typeof definition.meta.name !== 'string' || !definition.meta.name.trim())
      return 'meta.name is required'
    if (typeof definition.configSchema?.parse !== 'function')
      return 'configSchema.parse is required'
    if (typeof definition.defaultConfig !== 'function')
      return 'defaultConfig is required'
    try {
      const parsedDefault = definition.configSchema.parse(definition.defaultConfig())
      definition.configSchema.parse(parsedDefault)
    }
    catch (error) {
      return `defaultConfig fails its own schema: ${error instanceof Error ? error.message : String(error)}`
    }
    if (definition.migrations) {
      for (const [version, migration] of Object.entries(definition.migrations)) {
        if (!Number.isSafeInteger(Number(version)) || Number(version) < 1)
          return `invalid migration version "${version}"`
        if (typeof migration !== 'function')
          return `migration "${version}" must be a function`
      }
    }
    if (definition.surfaces !== undefined) {
      const surfacesError = validateSurfaces(definition.surfaces)
      if (surfacesError)
        return surfacesError
    }
    if (definition.variants !== undefined) {
      const variantsError = validateVariantsDeclaration(definition.variants) ?? validateVariantOverrides(definition.variants)
      if (variantsError)
        return variantsError
    }
    if (definition.icons !== undefined) {
      const iconsError = validateIconSet(definition.icons)
      if (iconsError)
        return iconsError
    }
    if (definition.tokens !== undefined) {
      if (!isRecord(definition.tokens))
        return 'tokens must be an object'
      for (const mode of ['light', 'dark'] as const) {
        const overrides = definition.tokens[mode]
        if (overrides === undefined)
          continue
        if (!isRecord(overrides))
          return `token overrides for ${mode} must be an object`
        try {
          const base = mode === 'dark' ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS
          tokensToCssVariables(freezeTokens(completeTokens(base, overrides as ThemeTokenOverrides)))
        }
        catch (error) {
          return `${mode} token overrides are invalid: ${error instanceof Error ? error.message : String(error)}`
        }
      }
    }
    return null
  }
}

export const themeRegistry = new ThemeRegistry().register(defaultTheme, { builtin: true })
