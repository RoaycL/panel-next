import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'
import { createSSRApp, h, inject as vueInject, provide as vueProvide, reactive as vueReactive, ref as vueRef } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, defineStore as piniaDefineStore, setActivePinia } from 'pinia'

/**
 * Theme Registry 专项验证（TypeScript 侧）：
 * - 注册、重复 ID、默认配置与 Token 完整性；
 * - 连续迁移与缺失迁移隔离；未知主题不丢失且 UI 回退默认主题；
 * - 序列化出口保证可通过 Go 校验（共享 wire 样本驱动）；
 * - Provider 原子应用与默认回退、预览取消与 Last Known Good；
 * - Web 与 Extension 主题选择互不覆盖。
 */

function readSource(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

/** 合并转译：去掉所有模块导入（源码按依赖顺序拼接）。 */
function endsWithImportTerminator(line) {
  const trimmed = line.trimEnd()
  return trimmed.endsWith(`'`)
    || trimmed.endsWith('"')
    || trimmed.endsWith(`';`)
    || trimmed.endsWith('";')
}

/** 拼接场景下，export { … } from '…' 再导出无法解析目标模块，直接移除。 */
function stripReexports(src) {
  return src.replace(/^export[ \t]*\{[^}]*\}[ \t]*from[ \t]*['"][^'"]+['"];?[ \t]*$/gm, '')
}

function stripAllImports(src) {
  // 确定性逐行扫描：import 语句可能跨多行，直到出现引号终止符。
  const kept = []
  let skipping = false
  for (const line of src.split('\n')) {
    if (!skipping && line.trimStart().startsWith('import')) {
      skipping = !endsWithImportTerminator(line)
      continue
    }
    if (skipping) {
      skipping = !endsWithImportTerminator(line)
      continue
    }
    kept.push(line)
  }
  return stripReexports(kept.join('\n'))
}

/** 拼接后仅保留共享辅助函数的第一份定义，避免重复声明。 */
function dedupeHelperDeclarations(src) {
  const helperNames = ['isPlainObject', 'isRecord', 'kebabize']
  for (const name of helperNames) {
    let firstRemoved = false
    src = src.replace(new RegExp(`^[ \\t]*function ${name}\\([^)]*\\)[^{]*\\{[\\s\\S]*?^[ \\t]*\\}`, 'gm'), (match) => {
      if (firstRemoved)
        return ''
      firstRemoved = true
      return match
    })
  }
  return src
}

const sourceOrder = [
  '../src/themes/types.ts',
  '../src/themes/constants.ts',
  '../src/themes/clone.ts',
  '../src/themes/tokens.ts',
  '../src/themes/icons.ts',
  '../src/themes/variants.ts',
  '../src/themes/cssVariables.ts',
  '../src/themes/schema.ts',
  '../src/themes/context.ts',
  '../src/themes/builtins/default.ts',
  '../src/themes/legacyAdapter.ts',
  '../src/themes/registry.ts',
  '../src/utils/defaultFooter.ts',
  '../src/utils/branding.ts',
]

let combined = sourceOrder.map(path => stripAllImports(readSource(path))).join('\n')

// 运行时模块依赖 Vue 响应式：通过 globalThis 桥接真实 Vue（行为级测试的关键）。
globalThis.__THEME_VUE__ = { ref: vueRef, reactive: vueReactive, computed: null }
globalThis.__THEME_VUE_INJECT__ = vueInject
const runtimeModuleSource = stripAllImports(readSource('../src/themes/runtime.ts'))
  .replace(/from 'vue'/, '')
const VUE_BRIDGE = `const { ref: __ref, reactive: __reactive, computed: __computed } = globalThis.__THEME_VUE__
const ref = __ref
const reactive = __reactive
const computed = __computed
const inject = (key, fallback) => globalThis.__THEME_VUE_INJECT__(key, fallback)
const getRuntime = () => ({ kind: globalThis.__THEME_RUNTIME_KIND__ || 'web' })
`

// themePackage.ts 依赖 crypto-js，用桩替换哈希后一并纳入（纯校验逻辑可测）。
combined += stripAllImports(readSource('../src/themes/themePackage.ts'))
  .replace("from 'crypto-js'", '')
  .replace(/import\s*\{\s*SHA256\s*\}\s*/, '')
// 提供一个可被 tree-shaken 的 SHA256 桩。
const queueSourceCode = stripAllImports(readSource('../src/themes/appearanceSaveQueue.ts'))
const storageSourceCode = stripAllImports(readSource('../src/themes/storage.ts'))
combined = `${VUE_BRIDGE}const SHA256 = (_input) => ({ toString: () => 'stub-digest' })\n${combined}\n${runtimeModuleSource}\n${queueSourceCode}\n${storageSourceCode}`
combined = dedupeHelperDeclarations(combined)

// legacyAdapter 引用了全局 Panel 命名空间类型（仅类型层面），运行时无需处理。

const transpiled = ts.transpileModule(combined, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'theme-registry.ts',
  reportDiagnostics: true,
})
if (transpiled.diagnostics?.length)
  throw new Error(`Unable to transpile theme registry: ${transpiled.diagnostics.map(d => d.messageText).join('; ')}`)
const encoded = Buffer.from(transpiled.outputText).toString('base64')
const mod = await import(`data:text/javascript;base64,${encoded}`)
const {
  ThemeRegistry,
  themeRegistry,
  THEME_SELECTION_SCHEMA_VERSION,
  validateThemeWireSelection,
  jsonSize,
  selectionFromLegacy,
  createDefaultSelection,
  needsThemeSelection,
  preparePanelAppearance,
  isLegacyBrandedFooter,
  validateThemePackage,
  themePackageToDefinition,
  computePackageDigest,
  isSafeAssetPath,
  DEFAULT_ICON_SET,
  DEFAULT_VARIANTS,
  tokensToCssVariables,
  resolveThemeIconResource,
  DEFAULT_LIGHT_TOKENS,
  DEFAULT_DARK_TOKENS,
  defaultThemeContextValue,
  isIconifyName,
  isLocalSpriteName,
  resolveVariantCssVariables,
} = mod

/* ------------------------------ 注册与契约 ------------------------------ */

assert.equal(themeRegistry.get('core.default')?.id, 'core.default', 'built-in default theme registered')
assert.ok(themeRegistry.list('web').length >= 1)
assert.ok(themeRegistry.list('extension').length >= 1)

function makeTheme(overrides = {}) {
  return {
    id: 'acme.pro',
    version: 1,
    meta: { name: 'Acme Pro' },
    surfaces: ['web', 'extension'],
    configSchema: { parse: value => (value && typeof value === 'object' ? { ...value } : {}) },
    defaultConfig: () => ({ density: 'cozy' }),
    migrations: { 1: config => ({ ...(config ?? {}), migrated: true }) },
    ...overrides,
  }
}

const registry = new ThemeRegistry().register(themeRegistry.get('core.default'), { builtin: true })
registry.register(makeTheme())
try {
  registry.register(makeTheme())
  assert.fail('duplicate registration should throw')
}
catch (error) {
  assert.match(String(error?.message ?? error), /already registered/)
}
assert.equal(registry.list('web').length, 2)
// 以下每个用例使用独立 ID，避免命中重复 ID 检查而掩盖目标违规。
assert.throws(() => registry.register(makeTheme({ id: 'core.hijack' })), /reserved/)
assert.throws(() => registry.register(makeTheme({ id: 'Bad ID' })), /invalid theme id/)
assert.throws(() => registry.register(makeTheme({ id: 'acme.bad.version', version: 0 })), /version/)
assert.throws(() => registry.register(makeTheme({ id: 'acme.bad.meta', meta: { name: '' } })), /meta\.name/)
assert.throws(() => registry.register(makeTheme({ id: 'acme.bad.surfaces', surfaces: ['desktop'] })), /surface/)
assert.throws(() => registry.register(makeTheme({ id: 'acme.bad.variants', variants: { bookmark: 'neon' } })), /variant/)
assert.throws(() => registry.register(makeTheme({ id: 'acme.bad.icons', icons: { notAnIcon: 'x' } })), /semantic icon/)
assert.throws(() => registry.register(makeTheme({
  id: 'acme.bad.tokens',
  tokens: { light: { color: { accent: 'javascript:alert(1)' } } },
})), /token/)
/* --------------------------- 选择创建与迁移链 --------------------------- */

const created = registry.createSelection('acme.pro', 'dark')
assert.equal(created.schemaVersion, THEME_SELECTION_SCHEMA_VERSION)
assert.equal(created.themeVersion, 1)
assert.deepEqual(created.config, { density: 'cozy' })

// 版本升级 v1 -> v2：连续迁移执行并解析新默认配置。
registry.register(makeTheme({ id: 'acme.migrating', version: 2, migrations: { 1: () => ({ upgraded: true }) } }))
const migratedLoad = registry.loadSelection(
  { schemaVersion: 1, themeId: 'acme.migrating', themeVersion: 1, mode: 'light', config: {} },
)
assert.equal(migratedLoad.quarantined, false)
assert.equal(migratedLoad.selection.themeVersion, 2)
assert.deepEqual(migratedLoad.resolved.config, { upgraded: true })
assert.ok(migratedLoad.issues.some(issue => /migrated/.test(issue.reason)))

// 缺失迁移 v1 -> v3：隔离保留原始数据，UI 使用默认主题。
registry.register(makeTheme({ id: 'acme.gap', version: 3, migrations: { 2: () => ({}) } }))
const gapLoad = registry.loadSelection(
  { schemaVersion: 1, themeId: 'acme.gap', themeVersion: 1, mode: 'light', config: {} },
)
assert.equal(gapLoad.quarantined, true)
assert.equal(gapLoad.resolved.definition.id, 'core.default')
assert.equal(gapLoad.selection.themeId, 'acme.gap')
assert.ok(gapLoad.issues.every(issue => issue.preserved))

/* ----------------------- 未知主题 / 损坏数据隔离 ------------------------ */

const unknownRaw = { schemaVersion: 1, themeId: 'vendor.unknown.future', themeVersion: 9, mode: 'auto', config: { keep: true } }
const unknownLoad = registry.loadSelection(unknownRaw)
assert.equal(unknownLoad.quarantined, true)
assert.equal(unknownLoad.resolved.id, 'core.default')
// 原始数据字段级保留（normalize 会补齐可选键为 undefined）。
assert.equal(unknownLoad.selection.themeId, 'vendor.unknown.future')
assert.equal(unknownLoad.selection.themeVersion, 9)
assert.deepEqual(unknownLoad.selection.config, { keep: true })
const roundTrip = JSON.parse(JSON.stringify(unknownLoad.selection))
for (const key of Object.keys(unknownRaw))
  assert.deepEqual(roundTrip[key], unknownRaw[key], key)

const corruptLoad = registry.loadSelection({ schemaVersion: 1, themeId: 'BAD', mode: 'nope' })
assert.equal(corruptLoad.quarantined, false)
assert.equal(corruptLoad.selection, null)
assert.equal(corruptLoad.issues[0].preserved, false)
const emptyLoad = registry.loadSelection(null)
assert.equal(emptyLoad.resolved.id, 'core.default')

// 非法 Token 覆盖：加载期隔离而非崩溃。
const badOverride = registry.resolve(registry.createSelection('core.default'), 'light')
assert.ok(badOverride.tokens.color.accent)
assert.throws(() => registry.resolve(
  { schemaVersion: 1, themeId: 'core.default', themeVersion: 1, mode: 'light', overrides: { color: { accent: 'url(evil)' } }, iconPackId: undefined },
), /Invalid color token/)

/* ------------------------------- 解析完整性 ------------------------------ */

const resolvedDefault = registry.resolve(registry.createSelection('core.default'), 'light')
assert.equal(Object.keys(resolvedDefault.tokens).length >= 10, true)
for (const group of ['color', 'font', 'radius', 'spacing', 'effect', 'bookmark', 'widget', 'sidebar', 'modal', 'notification', 'icon'])
  assert.ok(resolvedDefault.tokens[group], `missing token group ${group}`)
assert.equal(resolvedDefault.tokens.widget.chartColors.length >= 1, true)
assert.deepEqual(resolvedDefault.variants, DEFAULT_VARIANTS)
assert.deepEqual(resolvedDefault.icons.settings, DEFAULT_ICON_SET.settings)

const cssVariables = tokensToCssVariables(resolvedDefault.tokens)
assert.ok(cssVariables['--pn-color-accent'])
assert.ok(cssVariables['--pn-widget-chart-color-0'])
assert.ok(cssVariables['--pn-effect-blur'])
// 用户 Variant 覆盖 + 未知回退。
const variantResolved = registry.resolve(
  { schemaVersion: 1, themeId: 'core.default', themeVersion: 1, mode: 'light', variants: { search: 'underline', sidebar: 'weird' } },
)
assert.equal(variantResolved.variants.search, 'underline')
assert.equal(variantResolved.variants.sidebar, 'floating')

/* ------------------------- 序列化出口（Go 兼容） -------------------------- */

assert.deepEqual(registry.serialize(created), created)
assert.throws(() => registry.serialize(
  { schemaVersion: 1, themeId: 'acme.pro', themeVersion: 99, mode: 'light', config: {} },
), /exceeds the registered version/)
assert.throws(() => registry.serialize({ schemaVersion: 1, themeId: 'core.default', mode: 'light' }), /invalid/)
// 隔离数据：结构合法则原样保留；结构违规丢弃并告警。
const serializedQuarantine = registry.serialize(unknownRaw, { quarantined: true })
for (const key of Object.keys(unknownRaw))
  assert.deepEqual(serializedQuarantine?.[key], unknownRaw[key], key)
const consoleWarned = []
const originalWarn = console.warn
console.warn = (...args) => consoleWarned.push(args.join(' '))
const droppedQuarantine = registry.serialize({ schemaVersion: 1, themeId: 'vendor.x', themeVersion: 0 }, { quarantined: true })
console.warn = originalWarn
assert.equal(droppedQuarantine, null)
assert.ok(consoleWarned.some(text => /quarantined/i.test(text)))

/* ----------------------------- 共享 wire 样本 ---------------------------- */

const fixture = JSON.parse(readSource('../scripts/fixtures/theme-wire-samples.json'))
assert.ok(Array.isArray(fixture.selections) && fixture.selections.length > 0)
for (const sample of fixture.selections) {
  const candidate = structuredClone(sample.selection)
  if (sample.synthesizeBlob) {
    candidate.config = { blob: String.fromCodePoint(sample.synthesizeBlob.codepoint).repeat(sample.synthesizeBlob.repeat) }
  }
  let error = null
  try {
    error = validateThemeWireSelection(candidate)
  }
  catch (caughtError) {
    error = caughtError
  }
  if (sample.expect === 'valid')
    assert.equal(error, null, `sample "${sample.name}" should be valid: ${error}`)
  else
    assert.ok(error, `sample "${sample.name}" should be invalid`)
}

// 字节口径抽查：Go 将 < > & U+2028 U+2029 各转义为 \uXXXX（6 字节）。
// {"text":"X"} 共 11 个普通字符，X 为转义字符时计 6 字节。
for (const char of ['<', '>', '&', '\u2028', '\u2029'])
  assert.equal(jsonSize({ text: char }), 11 + 6, `escaped size for ${char}`)
assert.equal(jsonSize({ text: 'a' }), 11 + 1)

/* ----------------------------- 旧配置适配 ------------------------------ */

assert.equal(needsThemeSelection({}), true)
assert.equal(needsThemeSelection({ theme: { schemaVersion: 1 } }), false)
const legacy = selectionFromLegacy({ iconTextColor: '#123456' }, 'light')
assert.equal(legacy.themeId, 'core.default')
assert.deepEqual(legacy.overrides, { icon: { defaultColor: '#123456' } })
assert.deepEqual(selectionFromLegacy({ iconTextColor: '#ffffff' }, 'auto').overrides, {})
assert.deepEqual(createDefaultSelection('dark').mode, 'dark')

/* ------------------------------ 主题包安全 ------------------------------ */

assert.equal(isSafeAssetPath('assets/logo.png'), true)
for (const bad of ['/abs.png', '../escape.png', 'a//b.png', 'C:\\x.png', 'a/../../b.png', '.hidden.png'])
  assert.equal(isSafeAssetPath(bad), false, bad)
const packageErrors = validateThemePackage({
  format: 'panel-next-theme-package',
  formatVersion: 1,
  theme: { id: 'acme.pkg', version: 1, meta: { name: 'Pkg' } },
  assets: { 'evil.svg': { mimeType: 'image/svg+xml', dataBase64: Buffer.from('<svg onload="alert(1)">').toString('base64') } },
})
assert.ok(packageErrors.some(message => /SVG content/.test(message)))
assert.equal(validateThemePackage({
  format: 'panel-next-theme-package',
  formatVersion: 1,
  theme: { id: 'acme.pkg', version: 1, meta: { name: 'Pkg', homepage: 'https://example.com' } },
}).length, 0)
assert.ok(validateThemePackage({ format: 'other', formatVersion: 1 }).length > 0)

/* --------------------- 组件层接线（源级断言） --------------------------- */

const providerSource = readSource('../src/themes/ThemeProvider.vue')
assert.match(providerSource, /:style="view\.cssVariables"/, 'provider applies variables in one batch (atomic update)')
assert.match(providerSource, /buildProviderResult\(/, 'view built via testable pure function')
assert.match(providerSource, /data-widget="view\.variants\.widget"/, 'widget variant bound on root')
assert.match(providerSource, /data-bookmark="view\.variants\.bookmark"/, 'bookmark variant bound on root')
assert.match(providerSource, /data-sidebar="view\.variants\.sidebar"/, 'sidebar variant bound on root')
assert.match(providerSource, /data-search="view\.variants\.search"/, 'search variant bound on root')
assert.match(providerSource, /getThemePreview\(\)/, 'preview channel integrated')
assert.match(providerSource, /watchSystemMode/, 'auto mode follows system changes')
assert.match(providerSource, /onUnmounted/, 'system watcher cleaned up')
assert.match(providerSource, /provide\(THEME_CONTEXT_KEY/, 'context provided to descendants')

const contextSourceTheme = readSource('../src/themes/context.ts')
assert.match(contextSourceTheme, /export function useWidgetTheme/)
assert.match(contextSourceTheme, /chartColors/)
assert.match(contextSourceTheme, /THEME_CONTEXT_KEY/)
// WidgetHost 必须从叶子模块导入上下文，避免 widgets ↔ themes 运行时循环
const widgetHostSource = readSource('../src/widgets/WidgetHost.vue')
assert.match(widgetHostSource, /from '@\/themes\/context'/)

const modalSource = readSource('../src/themes/ThemeSettingsModal.vue')
assert.match(modalSource, /function requestClose\(/, 'single unified close path exists')
assert.match(modalSource, /@update:show="requestClose"/, 'modal close routes through requestClose (mask/ESC/X covered)')
assert.match(modalSource, /@click="requestClose\(false\)"/, 'cancel button routes through requestClose')
assert.match(modalSource, /watch\(\(\) => props\.show[\s\S]*?setThemePreview\(null\)/, 'any external close clears preview')
assert.match(modalSource, /saveLastKnownGood\(selection\)/, 'success records Last Known Good')
assert.match(modalSource, /themeRegistry\.serialize\(selection\)/, 'confirm validates before saving')
assert.match(modalSource, /const serialized = themeRegistry\.serialize\(selection\)/, 'strict exit validation before persist')
assert.match(modalSource, /serialized,/,'persist receives pre-validated selection')
// R2-6：真实表现 —— 图标包切换触发预览、description 显示、默认 Variant 显示、
// 清除 override、切换主题重置 config/variant/iconPack、保存中禁止重复关闭/提交。
assert.match(modalSource, /function updateIconPack\(/, 'icon pack change triggers preview')
assert.match(modalSource, /@update:value="updateIconPack"/, 'icon pack select wires preview')
assert.match(modalSource, /descriptor\.description[\s\S]*resolveText\(descriptor\.description\)/, 'config description rendered with i18n fallback')
assert.match(modalSource, /function effectiveVariant\(/, 'variant shows theme-declared default, not first option')
assert.match(modalSource, /activeDefinition\.value\?\.variants\?\.\[key\]/, 'variant default reads theme declaration')
assert.match(modalSource, /function resetVariant\(/, 'user can clear a variant override')
assert.match(modalSource, /theme\.variants\.followDefault/, 'follow-default entry present')
assert.match(modalSource, /draft\.variants = \{\}/, 'theme switch resets variant overrides')
assert.match(modalSource, /draft\.iconPackId = DEFAULT_ICON_PACK_ID/, 'theme switch resets icon pack')
assert.match(modalSource, /if \(saving\.value\)/, 'confirmSave guards double submit')
assert.ok((modalSource.match(/if \(saving\.value\)/g) ?? []).length >= 2, 'confirmSave + requestClose both guard doubles')
assert.match(modalSource, /function requestClose\(/, 'requestClose present')

const storageSource = readSource('../src/themes/storage.ts')
assert.match(storageSource, /saveExtensionAppearance/, 'extension persists into EXTENSION_APPEARANCE_KEY payload')
assert.match(storageSource, /response\.code !== 0/, 'web save verifies server code before committing store')
assert.match(storageSource, /store\.panelConfig = \{ \.\.\.store\.panelConfig, theme: serialized \}/, 'store commits by merging theme into latest config, not replacing whole config')
assert.match(storageSource, /const baseline = cloneJson\(store\.panelConfig\)/, 'persist captures a detached full-panel CAS baseline before saving')
assert.match(storageSource, /samePanelConfig\(store\.panelConfig, baseline\)/, 'persist compares the complete panel config after saving')
assert.match(storageSource, /enqueueAppearanceSave/, 'theme save is routed through the unified appearance save queue')
const conflictBranchStart = modalSource.indexOf('if (result.conflict) {')
const conflictBranchEnd = modalSource.indexOf('if (!result.ok', conflictBranchStart)
assert.ok(conflictBranchStart >= 0 && conflictBranchEnd > conflictBranchStart, 'conflict branch exists before the generic error branch')
assert.doesNotMatch(modalSource.slice(conflictBranchStart, conflictBranchEnd), /requestClose/, 'conflict keeps the editor open instead of reloading potentially stale persisted state')

const extensionView = readSource('../src/views/extension/index.vue')
assert.match(extensionView, /readExtensionAppearance/, 'extension reads local appearance')

const appIcon = readSource('../src/views/home/components/AppIcon/index.vue')
assert.match(appIcon, /iconTextColor/, 'user-configured icon text color (legacy field) still applied')
assert.match(appIcon, /itemInfo\?\.icon/, 'bookmark visuals remain user-data driven')
const themeIconSource = readSource('../src/themes/ThemeIcon.vue')
assert.match(themeIconSource, /DEFAULT_ICON_SET\[props\.name\]/, 'missing semantic icon falls back to default pack')


/* ===================== 行为级测试（真实响应式 + SSR 渲染） ===================== */

const {
  setPreferredDark,
  setThemePreview,
  commitLoadResult,

  buildProviderResult,
  createThemeContextValue,
  THEME_CONTEXT_KEY,
  useTheme,
  persistThemeSelection,
  getThemeRuntimeState,
  ensureThemeSelection,
  stripInvalidTheme,
} = mod

// 注册第二个主题：声明独立 Token/图标/Variant/Schema，用于预览与合并测试。
const strictSchema = {
  parse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return {}
    if ('evil' in value)
      throw new Error('config key "evil" is not allowed')
    return { ...value }
  },
}
registry.register({
  id: 'acme.night',
  version: 1,
  meta: { name: 'Acme Night' },
  surfaces: ['web', 'extension'],
  tokens: {
    light: {
      color: { accent: '#123456', surface: 'rgba(9,9,9,0.5)' },
      radius: { large: '22px' },
    },
    dark: {
      color: { accent: '#654321' },
    },
  },
  icons: { settings: 'acme-gear', close: 'acme-close' },
  variants: { bookmark: 'minimal', widget: 'solid', sidebar: 'attached', search: 'box' },
  configSchema: strictSchema,
  defaultConfig: () => ({}),
})
registry.registerIconPack('acme.icons', { settings: 'acme-pack-gear', close: 'line-md-close-small' })

const nightSelection = {
  schemaVersion: THEME_SELECTION_SCHEMA_VERSION,
  themeId: 'acme.night',
  themeVersion: 1,
  mode: 'light',
  config: {},
}

/* ---- B1: 深度合并分层 —— 用户只覆盖 accent 不丢主题声明的 surface ---- */
const layered = registry.resolve({ ...nightSelection, overrides: { color: { accent: '#ff0000' } } }, 'light')
assert.equal(layered.tokens.color.accent, '#ff0000')
assert.equal(layered.tokens.color.surface, 'rgba(9,9,9,0.5)', 'theme-declared surface survives user override')
assert.equal(layered.tokens.radius.large, '22px')

/* ---- B2: 只读保护 —— 嵌套对象与数组不可变 ---- */
assert.throws(() => { layered.tokens.widget.chartColors.push('#fff') })
assert.throws(() => { layered.tokens.color.accent = 'hack' })

/* ---- B3: auto 模式真实切换（系统明暗 → 完整重解析 Token） ---- */
const autoSelection = { schemaVersion: THEME_SELECTION_SCHEMA_VERSION, themeId: 'core.default', themeVersion: 1, mode: 'auto' }
setPreferredDark(true)
const viewDark = buildProviderResult(autoSelection, 'web', registry)
assert.equal(viewDark.resolvedMode, 'dark')
assert.match(viewDark.cssVariables['--pn-color-page-background'], /#020617/, 'dark tokens applied when system is dark')
setPreferredDark(false)
const viewLight = buildProviderResult(autoSelection, 'web', registry)
assert.equal(viewLight.resolvedMode, 'light')
assert.match(viewLight.cssVariables['--pn-color-page-background'], /#eef8ff/, 'light tokens restored')
assert.notEqual(viewLight.cssVariables['--pn-color-page-background'], viewDark.cssVariables['--pn-color-page-background'], 'light and dark page backgrounds must remain visually distinct')
// 显式 dark 选择不受系统影响
setPreferredDark(true)
const viewExplicitLight = buildProviderResult({ ...autoSelection, mode: 'light' }, 'web', registry)
assert.equal(viewExplicitLight.resolvedMode, 'light')
setPreferredDark(false)

/* ---- B4: 预览完整覆盖 Token/图标/Variant/主题 ID，且不污染全局状态 ---- */
commitLoadResult(registry.loadSelection(autoSelection), 'web')
const stateBefore = JSON.stringify(getThemeRuntimeState().resolved.id)
setThemePreview(nightSelection)
const viewPreview = buildProviderResult(nightSelection, 'web', registry)
assert.equal(viewPreview.loadResult.resolved.id, 'acme.night')
assert.equal(viewPreview.variants.bookmark, 'minimal')
assert.equal(viewPreview.loadResult.resolved.icons.settings, 'acme-gear')
assert.notEqual(stateBefore, '"acme.night"')
assert.equal(getThemeRuntimeState().resolved.id, JSON.parse(stateBefore), 'global runtime state untouched during preview')
// 图标包覆盖主题图标
const packView = buildProviderResult({ ...nightSelection, iconPackId: 'acme.icons' }, 'web', registry)
assert.equal(packView.loadResult.resolved.icons.settings, 'acme-pack-gear')
// 图标包覆盖主题声明的同名图标；未覆盖键回退主题/默认包
assert.equal(packView.loadResult.resolved.icons.close, 'line-md-close-small')
setThemePreview(null)
const viewRestored = buildProviderResult(autoSelection, 'web', registry)
assert.equal(viewRestored.loadResult.resolved.id, 'core.default')

/* ---- B5: 注入上下文端到端（SSR 真实渲染 useTheme 消费者） ---- */
async function renderConsumerWith(contextValue) {
  let captured = null
  const consumer = {
    setup() {
      const theme = useTheme()
      captured = { themeId: theme.themeId, icon: theme.icons.settings, variant: theme.variants.bookmark, mode: theme.resolvedMode }
      return () => h('span', `theme=${theme.themeId} icon=${theme.icons.settings} variant=${theme.variants.bookmark}`)
    },
  }
  const root = {
    setup() {
      vueProvide(THEME_CONTEXT_KEY, contextValue)
      return () => h(consumer)
    },
  }
  const html = await renderToString(createSSRApp(root))
  return { html, captured }
}

setPreferredDark(false)
setThemePreview(null)
{
  const view = buildProviderResult(nightSelection, 'web', registry)
  const box = vueReactive({ value: view })
  const provided = createThemeContextValue(() => ({
    surface: 'web',
    themeId: box.value.loadResult.resolved.id,
    resolvedMode: box.value.resolvedMode,
    quarantined: box.value.loadResult.quarantined,
    tokens: box.value.loadResult.resolved.tokens,
    icons: box.value.loadResult.resolved.icons,
    variants: box.value.loadResult.resolved.variants,
    selection: box.value.loadResult.selection,
  }))
  const first = await renderConsumerWith(provided)
  assert.equal(first.captured.themeId, 'acme.night')
  assert.match(first.html, /theme=acme\.night/)
  // 切换底层视图（等价 Provider 重算）：消费者无需重建即读到新值
  box.value = buildProviderResult(autoSelection, 'web', registry)
  const second = await renderConsumerWith(provided)
  assert.match(second.html, /theme=core\.default/)
}

/* ---- B6: 存储原子性 —— Web 失败回滚 / 成功提交 / 隔离跳过 ---- */
function makeStore() {
  return { panelConfig: { maxWidthUnit: 'px', theme: { schemaVersion: 1, themeId: 'core.default', themeVersion: 1, mode: 'light' } } }
}
{
  const store = makeStore()
  const calls = []
  const result = await persistThemeSelection(
    { surface: 'web', serialized: registry.serialize({ ...nightSelection }) },
    {
      getStore: () => store,
      readExtensionAppearance: () => null,
      saveExtensionAppearance: async () => true,
      setUserConfig: async (req) => { calls.push(req); return { code: 0 } },
    },
  )
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(store.panelConfig.theme.themeId, 'acme.night', 'store committed after server success')
}
{
  const store = makeStore()
  const snapshot = JSON.stringify(store.panelConfig)
  const result = await persistThemeSelection(
    { surface: 'web', serialized: registry.serialize({ ...nightSelection }) },
    {
      getStore: () => store,
      readExtensionAppearance: () => null,
      saveExtensionAppearance: async () => true,
      setUserConfig: async () => ({ code: 1502, msg: 'conflict' }),
    },
  )
  assert.equal(result.ok, false, 'server rejection surfaces as failure')
  assert.equal(JSON.stringify(store.panelConfig), snapshot, 'store untouched after failed web save')
}
{
  const store = makeStore()
  const extCalls = []
  globalThis.__THEME_RUNTIME_KIND__ = 'extension'
  const result = await persistThemeSelection(
    { surface: 'extension', serialized: registry.serialize({ ...nightSelection }) },
    {
      getStore: () => store,
      readExtensionAppearance: () => ({ maxWidthUnit: 'px' }),
      saveExtensionAppearance: async (cfg) => { extCalls.push(cfg); return true },
      setUserConfig: async () => { throw new Error('must not call server from extension') },
    },
  )
  assert.equal(result.ok, true)
  assert.equal(extCalls.length, 1)
  assert.equal(extCalls[0].theme.themeId, 'acme.night')
  assert.equal(store.panelConfig.theme.themeId, 'acme.night')
  globalThis.__THEME_RUNTIME_KIND__ = 'web'
}
{
  const store = makeStore()
  const snapshot = JSON.stringify(store.panelConfig)
  globalThis.__THEME_RUNTIME_KIND__ = 'extension'
  const result = await persistThemeSelection(
    { surface: 'extension', serialized: registry.serialize({ ...nightSelection }) },
    {
      getStore: () => store,
      readExtensionAppearance: () => null,
      saveExtensionAppearance: async () => false,
      setUserConfig: async () => ({ code: 0 }),
    },
  )
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(store.panelConfig), snapshot, 'store untouched when local write fails')
}
{
  // 显式丢弃（serialized=null）：跳过写入且不触碰 Store
  const store = makeStore()
  const result = await persistThemeSelection(
    { surface: 'web', serialized: null },
    {
      getStore: () => store,
      readExtensionAppearance: () => null,
      saveExtensionAppearance: async () => true,
      setUserConfig: async () => ({ code: 0 }),
    },
  )
  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(store.panelConfig.theme.themeId, 'core.default', 'quarantine-invalid data dropped without touching store')
}

/* ---- B6b: 并发语义 —— CAS + 字段级 merge，绝不静默覆盖较新的 panelConfig / theme ---- */

{
  // 1) Web 保存期间 logoText 被并发修改（字段级）：完整 CAS 必须用最新配置重试，
  //    最终服务端 Payload 与 Store 同时保留并发字段和用户确认的 theme。
  const store = makeStore()
  const received = []
  const result = await (() => {
    const p = persistThemeSelection(
      { surface: 'web', serialized: registry.serialize({ ...nightSelection }) },
      {
        getStore: () => store,
        readExtensionAppearance: () => null,
        saveExtensionAppearance: async () => true,
        setUserConfig: async (payload) => { received.push(payload); await new Promise(r => setTimeout(r, 20)); return { code: 0 } },
      },
    )
    setTimeout(() => { store.panelConfig.logoText = 'Concurrent Logo' }, 5)
    return p
  })()
  assert.equal(result.ok, true)
  assert.equal(received.length, 2, 'field-level edit triggers one full-config resync')
  assert.equal(received[0].panel.theme.themeId, 'acme.night', 'payload sends the confirmed theme')
  assert.equal(received[received.length - 1].panel.logoText, 'Concurrent Logo', 'final payload carries the concurrent field value')
  assert.equal(received[received.length - 1].panel.theme.themeId, 'acme.night', 'final payload retains the confirmed theme')
  assert.equal(store.panelConfig.logoText, 'Concurrent Logo', 'concurrent field edit survives theme save (field-merge commit)')
  assert.equal(store.panelConfig.theme.themeId, 'acme.night', 'confirmed theme committed')
}

{
  // 4b) theme 原地修改也必须被检测：基线是深克隆而不是对象引用。
  const store = makeStore()
  const received = []
  const result = await (() => {
    const p = persistThemeSelection(
      { surface: 'web', serialized: registry.serialize({ ...nightSelection }) },
      {
        getStore: () => store,
        readExtensionAppearance: () => null,
        saveExtensionAppearance: async () => true,
        setUserConfig: async (payload) => { received.push(payload); await new Promise(r => setTimeout(r, 20)); return { code: 0 } },
      },
    )
    setTimeout(() => { store.panelConfig.theme.mode = 'dark' }, 5)
    return p
  })()
  assert.equal(result.conflict, true, 'in-place theme mutation is detected as a conflict')
  assert.equal(received.length, 2, 'in-place mutation triggers a latest-state resync')
  assert.equal(received[received.length - 1].panel.theme.mode, 'dark', 'resync persists the in-place theme change')
  assert.equal(store.panelConfig.theme.mode, 'dark', 'in-place local theme remains intact')
}

{
  // 2) Web 保存期间整份 panelConfig 被替换：CAS 冲突 → 触发一次重同步（写最新整份配置），
  //    绝不覆盖新面板。校验重同步 Payload 到达了最新整份配置并把它交给服务端。
  const store = makeStore()
  const replacedTheme = { schemaVersion: 1, themeId: 'core.default', themeVersion: 1, mode: 'dark' }
  const received = []
  const result = await (() => {
    const p = persistThemeSelection(
      { surface: 'web', serialized: registry.serialize({ ...nightSelection }) },
      {
        getStore: () => store,
        readExtensionAppearance: () => null,
        saveExtensionAppearance: async () => true,
        setUserConfig: async (payload) => { received.push(payload); await new Promise(r => setTimeout(r, 20)); return { code: 0 } },
      },
    )
    setTimeout(() => { store.panelConfig = { maxWidthUnit: 'px', logoText: 'Replaced Panel', theme: replacedTheme } }, 5)
    return p
  })()
  assert.equal(result.conflict, true, 'whole-panelConfig replacement during save reports conflict')
  assert.equal(result.ok, false)
  assert.equal(received.length >= 2, true, 'conflict triggers a resync write of the latest config')
  assert.equal(received[0].panel.theme.themeId, 'acme.night', 'first write carries the confirmed theme')
  assert.deepEqual(received[received.length - 1].panel.theme, replacedTheme, 'resync re-saves the LATEST config so the server is reconciled to the newer value')
  assert.equal(received[received.length - 1].panel.logoText, 'Replaced Panel', 'resync payload carries the concurrent field value')
  assert.equal(store.panelConfig.theme === replacedTheme, true, 'replaced panelConfig preserved, not overwritten')
  assert.equal(store.panelConfig.logoText, 'Replaced Panel', 'replaced panelConfig fields preserved')
}

{
  // 3) Web 保存失败 + 并发字段修改：绝不回滚（旧实现会整份恢复快照，抹掉并发修改）。
  const store = makeStore()
  const received = []
  const result = await (() => {
    const p = persistThemeSelection(
      { surface: 'web', serialized: registry.serialize({ ...nightSelection }) },
      {
        getStore: () => store,
        readExtensionAppearance: () => null,
        saveExtensionAppearance: async () => true,
        setUserConfig: async (payload) => { received.push(payload); await new Promise(r => setTimeout(r, 20)); return { code: 1502, msg: 'conflict' } },
      },
    )
    setTimeout(() => { store.panelConfig.logoText = 'Concurrent Edit' }, 5)
    return p
  })()
  assert.equal(result.ok, false, 'server rejection surfaces as failure')
  assert.equal(received.length, 1, 'server rejection is not silently retried')
  assert.equal(received[0].panel.theme.themeId, 'acme.night', 'rejected write still carried the confirmed theme')
  assert.equal(store.panelConfig.logoText, 'Concurrent Edit', 'no rollback: concurrent field edit survives failed save')
  assert.equal(store.panelConfig.theme.themeId, 'core.default', 'theme untouched on failed save')
}

{
  // 4) 保存期间 theme 自身被并发修改：CAS 冲突 → 重同步最新 theme，绝不静默覆盖。
  const store = makeStore()
  const newerTheme = { schemaVersion: 1, themeId: 'acme.night', themeVersion: 1, mode: 'dark' }
  const received = []
  const result = await (() => {
    const p = persistThemeSelection(
      { surface: 'web', serialized: registry.serialize({ ...nightSelection }) },
      {
        getStore: () => store,
        readExtensionAppearance: () => null,
        saveExtensionAppearance: async () => true,
        setUserConfig: async (payload) => { received.push(payload); await new Promise(r => setTimeout(r, 20)); return { code: 0 } },
      },
    )
    setTimeout(() => { store.panelConfig.theme = newerTheme }, 5)
    return p
  })()
  assert.equal(result.conflict, true, 'theme self-modified during save is a conflict')
  assert.equal(received.length >= 2, true, 'theme conflict triggers a resync re-save')
  assert.deepEqual(received[received.length - 1].panel.theme, newerTheme, 'resync re-saves the newest theme so the server keeps the newer value')
  assert.equal(store.panelConfig.theme === newerTheme, true, 'newer theme preserved, not overwritten')
  assert.equal(store.panelConfig.theme.mode, 'dark', 'newer theme content intact')
}

{
  // 5) Extension flush 抛错（而非返回 false）：仍是失败，Store 不动。
  const store = makeStore()
  const snapshot = JSON.stringify(store.panelConfig)
  globalThis.__THEME_RUNTIME_KIND__ = 'extension'
  const result = await persistThemeSelection(
    { surface: 'extension', serialized: registry.serialize({ ...nightSelection }) },
    {
      getStore: () => store,
      readExtensionAppearance: () => ({ maxWidthUnit: 'px' }),
      saveExtensionAppearance: async () => { throw new Error('flush failed') },
      setUserConfig: async () => ({ code: 0 }),
    },
  )
  assert.equal(result.ok, false, 'extension flush failure surfaces as failure')
  assert.equal(JSON.stringify(store.panelConfig), snapshot, 'store untouched when extension flush fails')
  globalThis.__THEME_RUNTIME_KIND__ = 'web'
}

{
  // 6b) 配置在每次请求期间都变化：达到上限后不得覆盖/回滚最新本地状态，
  //     也不得宣称保存成功。UI 会保留弹窗让用户在变化停止后显式重试。
  const store = makeStore()
  const received = []
  let sequence = 0
  const result = await persistThemeSelection(
    { surface: 'web', serialized: registry.serialize({ ...nightSelection }) },
    {
      getStore: () => store,
      readExtensionAppearance: () => null,
      saveExtensionAppearance: async () => true,
      setUserConfig: async (payload) => {
        received.push(payload)
        sequence++
        store.panelConfig.logoText = `Changing ${sequence}`
        return { code: 0 }
      },
    },
  )
  assert.equal(result.ok, false)
  assert.equal(result.conflict, true, 'retry exhaustion is surfaced as a conflict')
  assert.equal(received.length, 3, 'resync retries stay bounded')
  assert.equal(store.panelConfig.logoText, 'Changing 3', 'latest local value is preserved after retry exhaustion')
}

{
  // 6) Extension 保存期间整份 panelConfig 被替换：CAS 冲突 → 重同步最新整份外观，不覆盖。
  //    校验最终 Extension 存储内容到达了较新的整份外观。
  const store = makeStore()
  const replacedTheme = { schemaVersion: 1, themeId: 'core.default', themeVersion: 1, mode: 'dark' }
  const written = []
  globalThis.__THEME_RUNTIME_KIND__ = 'extension'
  const result = await (() => {
    const p = persistThemeSelection(
      { surface: 'extension', serialized: registry.serialize({ ...nightSelection }) },
      {
        getStore: () => store,
        readExtensionAppearance: () => ({ maxWidthUnit: 'px' }),
        saveExtensionAppearance: async (config) => { written.push(config); await new Promise(r => setTimeout(r, 20)); return true },
        setUserConfig: async () => ({ code: 0 }),
      },
    )
    setTimeout(() => { store.panelConfig = { maxWidthUnit: 'px', theme: replacedTheme } }, 5)
    return p
  })()
  assert.equal(result.conflict, true, 'extension appearance replaced during save reports conflict')
  assert.equal(written.length >= 2, true, 'extension conflict triggers a resync write-back')
  assert.equal(written[0].theme.themeId, 'acme.night', 'first extension write carries the confirmed theme')
  assert.deepEqual(written[written.length - 1].theme, replacedTheme, 'final extension storage content is the latest (replaced) appearance, not the overwritten theme')
  assert.equal(store.panelConfig.theme === replacedTheme, true, 'replaced extension config preserved')
  globalThis.__THEME_RUNTIME_KIND__ = 'web'
}

{
  // 7) 队列串行：连续两次主题保存不可交错，顺序 enter/exit/enter/exit，最后提交者胜。
  const store = makeStore()
  const order = []
  const dep = {
    getStore: () => store,
    readExtensionAppearance: () => null,
    saveExtensionAppearance: async () => true,
    setUserConfig: async () => {
      order.push('enter')
      await new Promise(r => setTimeout(r, 15))
      order.push('exit')
      return { code: 0 }
    },
  }
  const p1 = persistThemeSelection({ surface: 'web', serialized: registry.serialize({ ...nightSelection, mode: 'light' }) }, dep)
  const p2 = persistThemeSelection({ surface: 'web', serialized: registry.serialize({ ...nightSelection, mode: 'dark' }) }, dep)
  await Promise.all([p1, p2])
  assert.deepEqual(order, ['enter', 'exit', 'enter', 'exit'], 'appearance saves are serialized, not interleaved')
  assert.equal(store.panelConfig.theme.mode, 'dark', 'last queued save wins')
}

/* ---- B7: 序列化出口执行 config Schema 校验 ---- */
assert.throws(() => registry.serialize(
  { schemaVersion: 1, themeId: 'acme.night', themeVersion: 1, mode: 'light', config: { evil: true } },
), /not allowed/)
assert.equal(registry.isQuarantinedSelection(unknownRaw), true, 'unknown theme flagged quarantined')
assert.equal(registry.isQuarantinedSelection(nightSelection), false)

/* ---- B7b: 迁移保存链 —— migrate → Schema 解析 → 写回 → 重新校验 → 返回当前版本 ---- */
{
  // v2 schema：只接受 { density }，拒绝任何其他键；v1 的旧 { compact } 结构无法直接通过。
  const v2Schema = {
    parse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return { density: 'cozy' }
      const out = {}
      for (const key of Object.keys(value)) {
        if (key === 'density' && (value.density === 'compact' || value.density === 'cozy' || value.density === 'relaxed'))
          out.density = value.density
        else
          throw new Error(`unexpected config key "${key}"`)
      }
      return out.density ? out : { density: 'cozy' }
    },
  }
  registry.register({
    id: 'acme.migrated',
    version: 2,
    meta: { name: 'Acme Migrated' },
    surfaces: ['web', 'extension'],
    configSchema: v2Schema,
    defaultConfig: () => ({ density: 'cozy' }),
    migrations: {
      // v1（旧 { compact } 结构）→ v2（{ density }）；panic 配置无法迁移。
      1: config => {
        if (config && config.panic)
          throw new Error('cannot migrate panic mode')
        return { density: (config && config.compact) ? 'compact' : 'cozy' }
      },
    },
  })

  // 场景 1：v1 原始配置不能通过 v2 schema（{ compact } 被拒），但迁移后可保存且返回 v2。
  const v1Raw = { schemaVersion: 1, themeId: 'acme.migrated', themeVersion: 1, mode: 'light', config: { compact: true } }
  assert.equal(registry.isQuarantinedSelection(v1Raw), false, 'migratable v1 selection is not quarantined')
  assert.throws(() => v2Schema.parse(v1Raw.config), /unexpected config key/, 'v1 config fails v2 schema directly')
  const serializedMigrated = registry.serialize(v1Raw)
  assert.equal(serializedMigrated.themeVersion, 2, 'serialize returns current (v2) version')
  assert.deepEqual(serializedMigrated.config, { density: 'compact' }, 'migrated config is written back')

  // 场景 2：迁移抛错 / 迁移结果无法通过 schema → 拒绝保存。
  const v1Panic = { schemaVersion: 1, themeId: 'acme.migrated', themeVersion: 1, mode: 'light', config: { panic: true } }
  assert.throws(() => registry.serialize(v1Panic), /cannot migrate panic mode/, 'migration failure rejects save')

  // 场景 3：迁移产生超限配置 → 隔离并拒绝保存。
  registry.register({
    id: 'acme.overflow',
    version: 2,
    meta: { name: 'Acme Overflow' },
    surfaces: ['web', 'extension'],
    configSchema: { parse: value => (value && typeof value === 'object' ? { ...value } : {}) },
    defaultConfig: () => ({}),
    migrations: {
      1: () => ({ blob: 'x'.repeat(64 * 1024) }),
    },
  })
  const overflowRaw = { schemaVersion: 1, themeId: 'acme.overflow', themeVersion: 1, mode: 'light', config: {} }
  const overflowLoad = registry.loadSelection(overflowRaw)
  assert.equal(overflowLoad.quarantined, true, 'overflow migration result is quarantined, not saved')
  assert.throws(() => registry.serialize(overflowRaw), /exceeds|64 KiB|config/, 'overflow serialization is blocked')
}

/* ---- B7c: 隔离判断复用完整解析（config Schema / Token / CSS 校验） ---- */
{
  // config Schema 失败 → 隔离。
  const schemaFail = { schemaVersion: 1, themeId: 'acme.night', themeVersion: 1, mode: 'light', config: { evil: true } }
  assert.equal(registry.isQuarantinedSelection(schemaFail), true, 'config schema violation flagged quarantined')
  // Token 失败 → 隔离。
  const tokenFail = { schemaVersion: 1, themeId: 'core.default', themeVersion: 1, mode: 'light', overrides: { color: { accent: 'url(evil)' } } }
  assert.equal(registry.isQuarantinedSelection(tokenFail), true, 'token override violation flagged quarantined')
  // 结构非法 → 非隔离（直接丢弃）。
  assert.equal(registry.isQuarantinedSelection({ schemaVersion: 1, themeId: 'BAD', mode: 'nope' }), false, 'structural violation is not quarantined')
}

/* ---- B7d: surface 契约 —— web-only 主题不能在 extension 渲染，反之亦然 ---- */
{
  // 注册 web-only 和 extension-only 主题。
  registry.register({
    id: 'acme.webonly',
    version: 1,
    meta: { name: 'Web Only' },
    surfaces: ['web'],
    configSchema: { parse: value => (value && typeof value === 'object' ? { ...value } : {}) },
    defaultConfig: () => ({}),
  })
  registry.register({
    id: 'acme.extonly',
    version: 1,
    meta: { name: 'Extension Only' },
    surfaces: ['extension'],
    configSchema: { parse: value => (value && typeof value === 'object' ? { ...value } : {}) },
    defaultConfig: () => ({}),
  })

  const webSel = { schemaVersion: 1, themeId: 'acme.webonly', themeVersion: 1, mode: 'light' }
  const extSel = { schemaVersion: 1, themeId: 'acme.extonly', themeVersion: 1, mode: 'light' }

  // web-only 在 web 端正常，在 extension 端隔离。
  assert.equal(registry.loadSelection(webSel, 'auto', 'light', 'web').quarantined, false, 'web-only works on web')
  assert.equal(registry.loadSelection(webSel, 'auto', 'light', 'extension').quarantined, true, 'web-only quarantined on extension')
  assert.equal(registry.isQuarantinedSelection(webSel, 'extension'), true, 'isQuarantinedSelection respects surface')

  // extension-only 在 extension 端正常，在 web 端隔离。
  assert.equal(registry.loadSelection(extSel, 'auto', 'light', 'extension').quarantined, false, 'ext-only works on extension')
  assert.equal(registry.loadSelection(extSel, 'auto', 'light', 'web').quarantined, true, 'ext-only quarantined on web')
  assert.equal(registry.isQuarantinedSelection(extSel, 'web'), true, 'isQuarantinedSelection respects surface on ext')

  // surface 不兼容时保留原始数据（themeId 不变），UI 回退 core.default。
  const webOnExt = registry.loadSelection(webSel, 'auto', 'light', 'extension')
  assert.equal(webOnExt.selection.themeId, 'acme.webonly', 'preserved in quarantined selection')
  assert.equal(webOnExt.resolved.id, 'core.default', 'UI falls back to core.default')

  // 主题中心 list() 按 surface 过滤：web-only 不出现在 extension 列表中。
  assert.ok(registry.list('web').some(def => def.id === 'acme.webonly'), 'web-only in web list')
  assert.ok(registry.list('extension').some(def => def.id === 'acme.extonly'), 'ext-only in ext list')
  assert.ok(registry.list('web').every(def => def.id !== 'acme.extonly'), 'ext-only not in web list')
  assert.ok(registry.list('extension').every(def => def.id !== 'acme.webonly'), 'web-only not in ext list')
}

/* ---- B8: 图标包注册表 ---- */
assert.throws(() => registry.registerIconPack('core.hijack-pack', { settings: 'x' }), /reserved/)
assert.ok(registry.listIconPacks().some(pack => pack.id === 'core.default'))
assert.ok(registry.listIconPacks().some(pack => pack.id === 'acme.icons'))

/* ---- B8b: 图标资源名安全解析（危险伪造 prefix / 在线加载控制） ---- */
  // 本地雪碧图名与合法 Iconify 名通过。
  assert.deepEqual(resolveThemeIconResource('mdi-pencil'), { kind: 'sprite', name: 'mdi-pencil' })
  assert.deepEqual(resolveThemeIconResource('mdi:pencil'), { kind: 'iconify', name: 'mdi:pencil' })
  assert.deepEqual(resolveThemeIconResource('tabler:logout'), { kind: 'iconify', name: 'tabler:logout' })

  // 危险前缀伪装成 Iconify → 一律拒绝。
  for (const bad of ['javascript:alert(1)', 'data:text/html,<svg>', 'http:evil', 'https:evil', 'vbscript:alert', 'file:evil', 'blob:evil', 'about:blank', 'chrome:settings']) {
    assert.equal(isIconifyName(bad), false, `dangerous pseudo-Iconify "${bad}" rejected`)
    assert.equal(resolveThemeIconResource(bad), null, `dangerous pseudo-Iconify "${bad}" resolver returns null`)
  }

  // 多个冒号 / 空段 / 大写协议 / 非法字符 → 拒绝。
  assert.equal(isIconifyName('a:b:c'), false)
  assert.equal(isIconifyName(':abc'), false)
  assert.equal(isIconifyName('abc:'), false)
  assert.equal(isIconifyName('JAVASCRIPT:alert(1)'), false, 'uppercase scheme still rejected')
  assert.equal(isIconifyName('mdi:bad icon'), false)

  // 长度上限拒绝。
  assert.equal(resolveThemeIconResource('x'.repeat(97)), null)

  // Extension 表面禁止 Iconify 在线加载：只接受本地雪碧图名，Iconify 回退 null。
  assert.equal(resolveThemeIconResource('mdi:pencil', { allowIconifyOnline: false }), null, 'extension rejects Iconify online')
  assert.deepEqual(resolveThemeIconResource('mdi-pencil', { allowIconifyOnline: false }), { kind: 'sprite', name: 'mdi-pencil' }, 'extension keeps local sprite')
  // Web 表面允许 Iconify。
  assert.deepEqual(resolveThemeIconResource('mdi:pencil', { allowIconifyOnline: true }), { kind: 'iconify', name: 'mdi:pencil' })

  // 默认图标集全部为本地雪碧图名（无冒号）：Extension 可离线渲染，不会触发外部请求。
  for (const value of Object.values(DEFAULT_ICON_SET)) {
    assert.equal(isLocalSpriteName(value), true, `default icon "${value}" is a local sprite name`)
    assert.equal(resolveThemeIconResource(value, { allowIconifyOnline: false })?.kind, 'sprite', `default icon "${value}" renders offline as sprite`)
  }

/* ---- B8c: 四类 Variant 的真实表现 ---- */
{
  const glass = { bookmark: 'glass', widget: 'glass', sidebar: 'floating', search: 'pill' }
  const solidBookmark = resolveVariantCssVariables({ ...glass, bookmark: 'solid' })
  const minimalBookmark = resolveVariantCssVariables({ ...glass, bookmark: 'minimal' })
  const borderlessWidget = resolveVariantCssVariables({ ...glass, widget: 'borderless' })
  const solidWidget = resolveVariantCssVariables({ ...glass, widget: 'solid' })
  const minimalSidebar = resolveVariantCssVariables({ ...glass, sidebar: 'minimal' })
  const attachedSidebar = resolveVariantCssVariables({ ...glass, sidebar: 'attached' })
  const boxSearch = resolveVariantCssVariables({ ...glass, search: 'box' })
  const underlineSearch = resolveVariantCssVariables({ ...glass, search: 'underline' })

  // Bookmark：solid 用 surface 背景 + 边框；minimal 阴影/边框透明。两者都作用于真实卡片容器。
  assert.equal(solidBookmark['--pn-bookmark-card-background'], 'var(--pn-color-surface)')
  assert.equal(minimalBookmark['--pn-bookmark-card-shadow'], 'none')
  assert.equal(minimalBookmark['--pn-bookmark-card-border'], 'transparent')
  assert.notDeepEqual(solidBookmark, minimalBookmark, 'bookmark solid vs minimal differ')

  // Widget：borderless 透明无边框无阴影；solid 用 surface 背景 + 边框。
  assert.equal(borderlessWidget['--pn-widget-background'], 'transparent')
  assert.equal(borderlessWidget['--pn-widget-shadow'], 'none')
  assert.equal(solidWidget['--pn-widget-background'], 'var(--pn-color-surface)')
  assert.equal(solidWidget['--pn-widget-border'], 'var(--pn-color-border)')
  assert.notDeepEqual(borderlessWidget, solidWidget, 'widget borderless vs solid differ')

  // Sidebar：minimal 透明无边框；attached 用 surface 背景。
  assert.equal(minimalSidebar['--pn-sidebar-background'], 'transparent')
  assert.equal(minimalSidebar['--pn-sidebar-border'], 'transparent')
  assert.equal(attachedSidebar['--pn-sidebar-background'], 'var(--pn-color-surface)')
  assert.notDeepEqual(minimalSidebar, attachedSidebar, 'sidebar minimal vs attached differ')

  // Search：box 用 surface 背景 + 中等圆角；underline 透明背景 + 0 圆角 + 底边线颜色。
  assert.equal(boxSearch['--pn-search-background'], 'var(--pn-color-surface)')
  assert.equal(boxSearch['--pn-search-radius'], 'var(--pn-radius-medium)')
  assert.equal(underlineSearch['--pn-search-background'], 'transparent')
  assert.equal(underlineSearch['--pn-search-radius'], '0')
  assert.equal(underlineSearch['--pn-search-underline'], 'var(--pn-color-accent)')
  assert.notDeepEqual(boxSearch, underlineSearch, 'search box vs underline differ')

  // 每种非默认 Variant 都产生真实的 --pn-* 覆盖（真实可观察差异，而非仅 data-* 属性）。
  const variants = [solidBookmark, minimalBookmark, borderlessWidget, solidWidget, minimalSidebar, attachedSidebar, boxSearch, underlineSearch]
  for (const v of variants)
    assert.ok(Object.keys(v).length > 0, 'each non-default variant emits real CSS overrides')

  // Variant 决定不同的 CSS 变量输出是互斥的：四类区域独立，不会互相污染。
  assert.equal(borderlessWidget['--pn-bookmark-card-background'], undefined, 'widget variant must not touch bookmark vars')
  assert.equal(underlineSearch['--pn-widget-background'], undefined, 'search variant must not touch widget vars')
}

/* ---- B9: 旧配置启动迁移（ensure/strip） ---- */
{
  const legacyConfig = { maxWidthUnit: 'px', iconTextColor: '#123456' }
  const { config: migrated, changed } = ensureThemeSelection(legacyConfig, 'dark')
  assert.equal(changed, true)
  assert.equal(migrated.theme.mode, 'dark')
  assert.equal(migrated.theme.overrides.icon.defaultColor, '#123456')
  const again = ensureThemeSelection(migrated, 'dark')
  assert.equal(again.changed, false)
}
{
  const corrupted = { maxWidthUnit: 'px', theme: { schemaVersion: 3, themeId: 'core.default', themeVersion: 1, mode: 'light' } }
  const { config: cleaned, changed } = stripInvalidTheme(corrupted)
  assert.equal(changed, true)
  assert.equal(cleaned.theme, undefined)
  const futureValid = { maxWidthUnit: 'px', theme: unknownRaw }
  assert.equal(stripInvalidTheme(futureValid).changed, false, 'structurally valid future theme preserved')
}

/* ---- B9b: 统一外观入口 preparePanelAppearance —— 全部端共用同一迁移语义 ---- */
{
  const mode = 'dark'
  const migrateBrand = (config) => (config.footerHtml && isLegacyBrandedFooter(config.footerHtml) ? { ...config, footerHtml: 'replaced' } : config)

  // 1) 非对象配置 → 用默认选择，记录 issue。
  const nonObject = preparePanelAppearance(null, 'web', mode, migrateBrand)
  assert.equal(nonObject.changed, true)
  assert.ok(nonObject.issues.length > 0, 'non-object config records an issue')
  assert.equal(nonObject.config.theme.mode, mode)

  // 2) 结构非法 theme → 剥离并补 core.default。
  const invalid = { maxWidthUnit: 'px', theme: { schemaVersion: 3, themeId: 'core.default', themeVersion: 1, mode: 'light' } }
  const invalidResult = preparePanelAppearance(invalid, 'web', mode, migrateBrand)
  assert.equal(invalidResult.changed, true)
  assert.equal(invalidResult.config.theme.themeId, 'core.default', 'invalid theme replaced with default')
  assert.ok(invalidResult.issues.some(issue => /invalid theme/.test(issue)), 'issue mentions dropped invalid theme')

  // 3) 结构合法的未知/未来主题保留，不能误删。
  const future = { maxWidthUnit: 'px', theme: unknownRaw }
  const futureResult = preparePanelAppearance(future, 'web', mode, migrateBrand)
  assert.equal(futureResult.changed, false, 'structurally valid future theme preserved')
  assert.deepEqual(futureResult.config.theme, unknownRaw, 'future theme untouched')

  // 4) 缺 theme → 自动补默认；其他 panelConfig 字段不被覆盖。
  const missing = { maxWidthUnit: 'px', logoText: 'My Logo' }
  const missingResult = preparePanelAppearance(missing, 'extension', mode, migrateBrand)
  assert.equal(missingResult.changed, true)
  assert.equal(missingResult.config.theme.themeId, 'core.default')
  assert.equal(missingResult.config.logoText, 'My Logo', 'auto-theme does not overwrite other fields')

  // 5) 带自定义 iconTextColor → 映射为 icon Token override。
  const legacyColor = { maxWidthUnit: 'px', iconTextColor: '#123456' }
  const legacyColorResult = preparePanelAppearance(legacyColor, 'web', mode, migrateBrand)
  assert.equal(legacyColorResult.changed, true)
  assert.equal(legacyColorResult.config.theme.overrides.icon.defaultColor, '#123456')

  // 6) 品牌迁移注入生效。
  const branded = { footerHtml: '<div>Powered By <a href="https://github.com/hslr-s/sun-panel">Sun-Panel</a></div>' }
  const brandedResult = preparePanelAppearance(branded, 'web', mode, migrateBrand)
  assert.equal(brandedResult.config.footerHtml, 'replaced', 'branding migration injected')

  // 7) 幂等：已迁移配置重复调用返回 changed=false。
  const idempotent = preparePanelAppearance(missingResult.config, 'extension', mode, migrateBrand)
  assert.equal(idempotent.changed, false, 'already-migrated config is idempotent')

  // 8) surface 不参与删删（结构合法主题保留），但传入合法表面不报错。
  assert.equal(preparePanelAppearance(missing, 'extension', mode, migrateBrand).changed, true)

  // 9) 跨表面幂等：对 'web' 表面预热出来的配置再以 'extension' 表面重新处理，
  //    结构已合法 → changed=false；surface 只影响默认值/迁移决策，不强制改写结构。
  const webPrepared = preparePanelAppearance({ ...missing, theme: createDefaultSelection(mode) }, 'web', mode, migrateBrand)
  const crossSurface = preparePanelAppearance(webPrepared.config, 'extension', mode, migrateBrand)
  assert.equal(crossSurface.changed, false, 'config prepared for web is idempotent on extension surface')

  // 10) prepare 后返回的 config 是干净的：重复调用不产生新的 issue，且幂等。
  const cfgA = preparePanelAppearance({ logoText: 'x' }, 'web', mode, migrateBrand)
  const cfgB = preparePanelAppearance(cfgA.config, 'web', mode, migrateBrand)
  assert.equal(cfgB.changed, false, 'normalized config re-prepares idempotently')
  assert.equal(cfgB.issues.length, 0, 'already-normalized config has no new issues')
}

/* ---- B9c: 双端边界 —— store 统一入口、单次 prepare 与回写约束 ---- */
{
  // 该组断言是结构守卫，配合 B9b / B6b / test-extension-persistence 的真实行为测试
  // （prepare 幂等、saveExtensionAppearance 字节去重回声抑制）共同锁定双端边界。
  const storeSource = stripAllImports(readSource('../src/store/modules/panel/index.ts'))
  const extensionView = stripAllImports(readSource('../src/views/extension/index.vue'))
  const homeView = stripAllImports(readSource('../src/views/home/index.vue'))

  // 1) store 是唯一 prepare 入口：applyPanelConfig 内部恰好一次 preparePanelAppearance。
  const prepareCalls = (storeSource.match(/preparePanelAppearance\s*\(/g) || []).length
  assert.equal(prepareCalls, 1, 'store applyPanelConfig calls preparePanelAppearance exactly once')

  // 2) 回写仅限 Extension：saveExtensionAppearance 只在 writeBack && surface === 'extension' 下被调用。
  assert.match(storeSource, /writeBack\s*&&\s*surface\s*===\s*'extension'/, 'writeback gated to extension surface')
  assert.match(storeSource, /saveExtensionAppearance\s*\(\s*this\.panelConfig\s*\)/, 'writeback persists merged panelConfig')
  assert.match(storeSource, /return\s+appearance/, 'store exposes { config, changed, issues }')

  // 3) extension 端不得把面板配置写回云端 userConfig/set。
  assert.doesNotMatch(extensionView, /setUserConfig\s*\(/, 'extension view never writes panel back to cloud')

  // 4) web home 端：applyPanelConfig 的回写开关由 runtime.kind 门控（web 恒为 false）。
  //    home/index.vue 只打包进 web 运行时，extension bundle 通过 __PANEL_RUNTIME__ 被摇树移除，
  //    因此 web 端不会触碰 EXTENSION_APPEARANCE_KEY。
  assert.match(homeView, /writeBack\s*:\s*runtime\.kind\s*===\s*'extension'/, 'home writeBack gated to extension runtime')
  assert.doesNotMatch(homeView, /saveExtensionAppearance\s*\(/, 'home no longer imports saveExtensionAppearance')
}

/* ---- B9c2: store.applyPanelConfig 行为 —— 真实 Pinia 挂载 + 可等待 writeBack + flush 失败 ---- */
{
  // 用真实 Pinia 挂载 store，验证 applyPanelConfig 返回可等待的 writeBack Promise
  // （成功 resolve=true、flush 抛错 resolve=false），不再依赖 fire-and-forget 猜测持久化结果。
  const storeModuleSource = stripAllImports(readSource('../src/store/modules/panel/index.ts'))
  const fallbackPanel = { maxWidthUnit: 'px', theme: { schemaVersion: 1, themeId: 'core.default', themeVersion: 1, mode: 'light' } }
  const storePrelude = `
const defineStore = globalThis.__STORE_TEST__.defineStore
const defaultState = () => ({ leftSiderCollapsed: false, rightSiderCollapsed: false, networkMode: 'wan', panelConfig: { ...${JSON.stringify(fallbackPanel)} } })
const defaultStatePanelConfig = () => ({ ...${JSON.stringify(fallbackPanel)} })
const getLocalState = () => null
const setLocalState = () => {}
const removeLocalState = () => {}
const migrateLegacyBranding = (config) => config
const router = { push: async () => {} }
const getUserConfig = async () => ({ code: 0, data: { panel: {} } })
const getRuntime = () => globalThis.__STORE_TEST__.runtimeKind()
const saveExtensionAppearance = (config) => globalThis.__STORE_TEST__.save(config)
const preparePanelAppearance = (config) => ({ config: config || {}, changed: false, issues: [] })
`
  // defineStore 在模块求值时绑定一次，必须先于 import 注入；save/runtimeKind 在调用时动态读取。
  globalThis.__VUE_PROD_DEVTOOLS__ = false
  globalThis.__STORE_TEST__ = {
    defineStore: piniaDefineStore,
    runtimeKind: () => 'extension',
    save: async () => true,
  }
  const storeBytecode = ts.transpileModule(`${storePrelude}\n${storeModuleSource}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: 'panel-store.ts', reportDiagnostics: true })
  if (storeBytecode.diagnostics?.length)
    throw new Error(`Unable to transpile panel store: ${storeBytecode.diagnostics.map(d => d.messageText).join('; ')}`)
  const storeEncoded = Buffer.from(storeBytecode.outputText).toString('base64')
  const { usePanelState } = await import(`data:text/javascript;base64,${storeEncoded}`)

  const themeSel = { schemaVersion: 1, themeId: 'acme.night', themeVersion: 1, mode: 'dark' }

  // 场景 A：Extension 回写成功 —— writeBack 是 Promise 且 resolve=true。
  {
    const writes = []
    globalThis.__STORE_TEST__ = {
      defineStore: piniaDefineStore,
      runtimeKind: () => 'extension',
      save: async (config) => { writes.push(config); await Promise.resolve(); return true },
    }
    setActivePinia(createPinia())
    const panelState = usePanelState()
    const res = panelState.applyPanelConfig({ maxWidthUnit: 'px', logoText: 'Hello', theme: themeSel }, { surface: 'extension', writeBack: true })
    assert.ok(res.writeBack instanceof Promise, 'applyPanelConfig exposes an awaitable writeBack promise')
    assert.equal(res.changed, false, 'prepare result surfaced through store')
    const persisted = await res.writeBack
    assert.equal(persisted, true, 'successful extension flush resolves writeBack=true')
    assert.equal(writes.length, 1, 'writeBack persists the cleaned appearance exactly once')
    assert.equal(writes[0].theme.themeId, 'acme.night', 'writeBack persists the applied theme')
    assert.equal(panelState.panelConfig.logoText, 'Hello', 'applyPanelConfig applied the config into the store')
  }

  // 场景 B：Extension flush 抛错 —— writeBack resolve=false，调用方可感知持久化失败。
  {
    globalThis.__STORE_TEST__ = {
      defineStore: piniaDefineStore,
      runtimeKind: () => 'extension',
      save: async () => { throw new Error('flush failed') },
    }
    setActivePinia(createPinia())
    const panelState = usePanelState()
    // store 出错路径会用 console.error 记录持久化失败；测试期间静音以免噪音刷屏，断言聚焦在返回值契约。
    const err = console.error
    console.error = () => {}
    try {
      const res = panelState.applyPanelConfig({ maxWidthUnit: 'px', logoText: 'Boom', theme: themeSel }, { surface: 'extension', writeBack: true })
      assert.ok(res.writeBack instanceof Promise, 'writeBack returned even when flush will fail')
      const persisted = await res.writeBack
      assert.equal(persisted, false, 'flush failure resolves writeBack=false so callers do not fake sync success')
      assert.equal(panelState.panelConfig.logoText, 'Boom', 'store still applied the config on write-back failure (no rollback in prepare path)')
    } finally {
      console.error = err
    }
  }

  // 场景 B2：底层按 Promise<boolean> 契约 resolve(false) 时不得被 then(() => true) 吞掉。
  {
    globalThis.__STORE_TEST__ = {
      defineStore: piniaDefineStore,
      runtimeKind: () => 'extension',
      save: async () => false,
    }
    setActivePinia(createPinia())
    const panelState = usePanelState()
    const res = panelState.applyPanelConfig({ maxWidthUnit: 'px', logoText: 'False Result', theme: themeSel }, { surface: 'extension', writeBack: true })
    assert.equal(await res.writeBack, false, 'resolved false remains false and is observable by callers')
  }

  // 场景 C：Web 表面即使传 writeBack:true 也绝不写扩展存储。
  {
    const writes = []
    globalThis.__STORE_TEST__ = {
      defineStore: piniaDefineStore,
      runtimeKind: () => 'extension',
      save: async (config) => { writes.push(config); await Promise.resolve(); return true },
    }
    setActivePinia(createPinia())
    const panelState = usePanelState()
    const res = panelState.applyPanelConfig({ maxWidthUnit: 'px', logoText: 'Web', theme: themeSel }, { surface: 'web', writeBack: true })
    assert.equal(res.writeBack, undefined, 'web surface does not expose an extension writeBack')
    assert.equal(writes.length, 0, 'web surface never writes EXTENSION_APPEARANCE_KEY')
    assert.equal(panelState.panelConfig.logoText, 'Web', 'web config still applied')
  }
}

/* ---- B9d: 受控渲染边界 —— component 是 @deprecated 保留字段，禁止进入渲染路径 ---- */
{
  const providerSource = stripAllImports(readSource('../src/themes/ThemeProvider.vue'))
  const packageSource = stripAllImports(readSource('../src/themes/themePackage.ts'))

  // ThemeProvider 只消费数据（resolveTokens/variants），渲染路径不得引用 .component。
  assert.doesNotMatch(providerSource, /\.component\s*[).\]]/, 'ThemeProvider never renders definition.component')

  // themePackageToDefinition 必须剥离 component（外部数据主题包不得注入渲染器）。
  assert.match(packageSource, /delete\s*\([^)]*definition[^)]*\)\.component/, 'themePackage drops definition.component')
}

/* ---- B10: 主题包安全强化 ---- */
const svgHead = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/>').toString('base64')
const svgTailPayload = '</svg>'
const pad = '-'.repeat(5000)
const tailAttack = `${svgHead}${Buffer.from(svgTailPayload).toString('base64')}${pad}`
const basePackage = {
  format: 'panel-next-theme-package',
  formatVersion: 1,
  theme: { id: 'acme.pkg', version: 1, meta: { name: 'Pkg' }, icons: { settings: 'pkg-gear-sprite' } },
  assets: {
    'assets/icon.png': { mimeType: 'image/png', dataBase64: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).toString('base64') },
  },
}
assert.deepEqual(validateThemePackage(basePackage), [], 'well-formed package passes')
// SVG 危险内容藏在 Base64 后段也能被发现
const evilTailSvg = `${'<svg><rect/>'.padEnd(6000, '.')}${tailAttack}<script>alert(1)</script><foreignObject /><style>@import url(https://evil.example);</style></svg>`
const evilTailErrors = validateThemePackage({
  ...basePackage,
  assets: { ...basePackage.assets, 'assets/evil.svg': { mimeType: 'image/svg+xml', dataBase64: Buffer.from(evilTailSvg).toString('base64') } },
})
assert.ok(evilTailErrors.some(message => /SVG content/.test(message)), 'tail-position script detected')
// 非法 Base64
assert.ok(validateThemePackage({
  ...basePackage,
  assets: { ...basePackage.assets, 'assets/bad.png': { mimeType: 'image/png', dataBase64: 'not@@base64!!' } },
}).some(message => /Base64/.test(message)))
// MIME 与魔数不符
assert.ok(validateThemePackage({
  ...basePackage,
  assets: { ...basePackage.assets, 'assets/fake.png': { mimeType: 'image/png', dataBase64: Buffer.from('GIF89a').toString('base64') } },
}).some(message => /does not match its MIME/.test(message)))
// 预览引用缺失资源
assert.ok(validateThemePackage({
  format: 'panel-next-theme-package',
  formatVersion: 1,
  theme: { id: 'acme.pkg2', version: 1, meta: { name: 'Pkg', preview: 'assets/preview.png' } },
}).some(message => /missing asset|defines no assets/.test(message)))
// 非法 Variant 声明
assert.ok(validateThemePackage({
  format: 'panel-next-theme-package',
  formatVersion: 1,
  theme: { id: 'acme.pkg3', version: 1, meta: { name: 'Pkg', homepage: 'https://example.com' }, variants: { bookmark: 'neon' } },
}).some(message => /bookmark variant/.test(message)))
// 非法 Token 覆盖
assert.ok(validateThemePackage({
  format: 'panel-next-theme-package',
  formatVersion: 1,
  theme: {
    id: 'acme.pkg4', version: 1, meta: { name: 'Pkg', homepage: 'https://example.com' },
    tokens: { light: { color: { accent: 'url(javascript:)' } } },
  },
}).some(message => /token overrides are invalid/.test(message)))
// 非对象 variants 不应使校验器崩溃，而应返回错误
assert.ok(validateThemePackage({
  format: 'panel-next-theme-package',
  formatVersion: 1,
  theme: { id: 'acme.pkg5', version: 1, meta: { name: 'Pkg', homepage: 'https://example.com' }, variants: 'neon' },
}).some(message => /variants must be an object/.test(message)))
// 图标引用内置雪碧图名（非资源路径）不要求资产存在
assert.equal(validateThemePackage(basePackage).length, 0)

// 导入流程：转换 → 注册 → 摘要稳定；代码字段被剥离
const importedDefinition = themePackageToDefinition({ ...basePackage, theme: { ...basePackage.theme, resolveTokensHint: 'must be ignored' } })
assert.equal(importedDefinition.resolveTokens, undefined)
assert.equal(importedDefinition.component, undefined)
const digestA = computePackageDigest(basePackage)
const digestB = computePackageDigest(structuredClone(basePackage))
assert.equal(digestA, digestB)

/* ---- B10b: 数据主题包图标资源模型 —— 只允许雪碧图名/合法 Iconify 名，禁止 assets 路径 ---- */
  // 危险 scheme 伪装成 Iconify prefix → 拒绝。
  assert.ok(validateThemePackage({
    format: 'panel-next-theme-package', formatVersion: 1,
    theme: { id: 'acme.pkg-js', version: 1, meta: { name: 'Pkg' }, icons: { settings: 'javascript:alert(1)' } },
  }).some(m => /not allowed|valid Iconify|local sprite/.test(m)), 'javascript icon prefix rejected')
  assert.ok(validateThemePackage({
    format: 'panel-next-theme-package', formatVersion: 1,
    theme: { id: 'acme.pkg-data', version: 1, meta: { name: 'Pkg' }, icons: { settings: 'data:image/svg+xml' } },
  }).some(m => /not allowed|valid Iconify|local sprite/.test(m)), 'data icon prefix rejected')
  assert.ok(validateThemePackage({
    format: 'panel-next-theme-package', formatVersion: 1,
    theme: { id: 'acme.pkg-http', version: 1, meta: { name: 'Pkg' }, icons: { settings: 'https:evil' } },
  }).some(m => /not allowed|valid Iconify|local sprite/.test(m)), 'https icon prefix rejected')

  // assets 路径作为 icons 值 → 拒绝（即使 assets 缺失也要报错）。
  assert.ok(validateThemePackage({
    format: 'panel-next-theme-package', formatVersion: 1,
    theme: { id: 'acme.pkg-asset-icon', version: 1, meta: { name: 'Pkg' }, icons: { settings: 'assets/icons/gear.svg' } },
  }).some(m => /assets paths are not allowed|valid Iconify|local sprite/.test(m)), 'assets path icon value rejected')

  // ../ 与绝对路径作为 icons 值 → 拒绝。
  assert.ok(validateThemePackage({
    format: 'panel-next-theme-package', formatVersion: 1,
    theme: { id: 'acme.pkg-dotdot', version: 1, meta: { name: 'Pkg' }, icons: { settings: '../secret' } },
  }).some(m => /not allowed/.test(m)), 'path traversal icon value rejected')

  // 合法雪碧图名与合法 Iconify 名通过。
  assert.equal(validateThemePackage({
    format: 'panel-next-theme-package', formatVersion: 1,
    theme: { id: 'acme.pkg-ok', version: 1, meta: { name: 'Pkg' }, icons: { settings: 'pkg-gear' } },
  }).length, 0, 'sprite icon name passes')
  assert.equal(validateThemePackage({
    format: 'panel-next-theme-package', formatVersion: 1,
    theme: { id: 'acme.pkg-ok2', version: 1, meta: { name: 'Pkg' }, icons: { settings: 'mdi:pencil' } },
  }).length, 0, 'valid Iconify name passes')

/* ---- B10c: 主题包 config 大小口径统一（jsonSize，非 .length）与 createSelection/register 校验 ---- */
{
  // configDefaults 大小用 wire jsonSize 口径：非 ASCII / < > & 按更大字节计，超出即拒绝。
  const nonAsciiOversize = { blob: `${'x'.repeat(100)}${'✓'.repeat(20000)}<&>` }
  assert.ok(validateThemePackage({
    format: 'panel-next-theme-package', formatVersion: 1,
    theme: { id: 'acme.pkg-bytes', version: 1, meta: { name: 'Pkg' }, configDefaults: nonAsciiOversize },
  }).length > 0, 'oversized non-ASCII configDefaults rejected')

  // createSelection 产物必须通过 wire 契约：超大 defaultConfig 的注册应立马抛错。
  assert.throws(() => registry.register({
    id: 'acme.toobig', version: 1, meta: { name: 'Too Big' },
    configSchema: { parse: value => (value && typeof value === 'object' ? { ...value } : {}) },
    defaultConfig: () => ({ blob: 'x'.repeat(64 * 1024) }),
  }), /exceeds|wire contract/, 'register with oversized defaultConfig throws')
  assert.throws(() => registry.register({
    id: 'acme.bad-default', version: 1, meta: { name: 'Bad Default' },
    configSchema: { parse: () => { throw new Error('schema rejects defaults') } },
    defaultConfig: () => ({ idk: 1 }),
  }), /Invalid theme definition|defaultConfig|schema/, 'register whose defaultConfig fails its schema throws')

  // 正常注册后，createSelection 可安全通过 wire 契约。
  registry.register({
    id: 'acme.create-ok', version: 1, meta: { name: 'Create OK' },
    configSchema: { parse: value => (value && typeof value === 'object' ? { ...value } : {}) },
    defaultConfig: () => ({ density: 'cozy' }),
  })
  const created = registry.createSelection('acme.create-ok', 'dark')
  assert.equal(validateThemeWireSelection(created), null, 'createSelection output passes wire contract')
}

/* ---- B10d: 深冻结 —— 默认 Token 集 / fallbackResolved / 默认上下文嵌套不可修改 ---- */
// 用 Object.isFrozen 显式断言路径真实存在且被冻结；若路径写错（访问 undefined）会抛错，
// 而不是像「给 undefined 元素赋值」那样只是误抛 TypeError 而静默通过。
function assertFrozen(value, label) {
  assert.equal(Object.isFrozen(value), true, `${label} should be frozen`)
}
// 默认浅色 Token：顶级 + 嵌套 + 图表色板数组全部冻结。
assertFrozen(DEFAULT_LIGHT_TOKENS, 'DEFAULT_LIGHT_TOKENS')
assertFrozen(DEFAULT_LIGHT_TOKENS.color, 'DEFAULT_LIGHT_TOKENS.color')
assertFrozen(DEFAULT_LIGHT_TOKENS.widget, 'DEFAULT_LIGHT_TOKENS.widget')
assertFrozen(DEFAULT_LIGHT_TOKENS.widget.chartColors, 'DEFAULT_LIGHT_TOKENS.widget.chartColors')
// 默认暗色 Token 对应嵌套节点冻结。
assertFrozen(DEFAULT_DARK_TOKENS, 'DEFAULT_DARK_TOKENS')
assertFrozen(DEFAULT_DARK_TOKENS.color, 'DEFAULT_DARK_TOKENS.color')
assertFrozen(DEFAULT_DARK_TOKENS.widget, 'DEFAULT_DARK_TOKENS.widget')
assertFrozen(DEFAULT_DARK_TOKENS.widget.chartColors, 'DEFAULT_DARK_TOKENS.widget.chartColors')
assert.notEqual(DEFAULT_LIGHT_TOKENS.widget.background, DEFAULT_DARK_TOKENS.widget.background, 'widget surface must visibly differ between light and dark modes')
assert.notEqual(DEFAULT_LIGHT_TOKENS.widget.textColor, DEFAULT_DARK_TOKENS.widget.textColor, 'widget text must visibly differ between light and dark modes')
assert.notEqual(DEFAULT_LIGHT_TOKENS.sidebar.background, DEFAULT_DARK_TOKENS.sidebar.background, 'sidebar surface must visibly differ between light and dark modes')
assert.notEqual(DEFAULT_LIGHT_TOKENS.icon.defaultColor, DEFAULT_DARK_TOKENS.icon.defaultColor, 'system icon color must visibly differ between light and dark modes')
// 默认上下文（回退值）整体 + tokens + 图表色板冻结。
assertFrozen(defaultThemeContextValue, 'defaultThemeContextValue')
assertFrozen(defaultThemeContextValue.tokens, 'defaultThemeContextValue.tokens')
assertFrozen(defaultThemeContextValue.tokens.widget, 'defaultThemeContextValue.tokens.widget')
assertFrozen(defaultThemeContextValue.tokens.widget.chartColors, 'defaultThemeContextValue.tokens.widget.chartColors')
assertFrozen(defaultThemeContextValue.icons, 'defaultThemeContextValue.icons')
assertFrozen(defaultThemeContextValue.variants, 'defaultThemeContextValue.variants')
// 解析回退（fallbackResolved）返回的嵌套 tokens / variants / icons 冻结。
assertFrozen(resolvedDefault.tokens, 'resolvedDefault.tokens')
assertFrozen(resolvedDefault.tokens.color, 'resolvedDefault.tokens.color')
assertFrozen(resolvedDefault.tokens.widget, 'resolvedDefault.tokens.widget')
assertFrozen(resolvedDefault.tokens.widget.chartColors, 'resolvedDefault.tokens.widget.chartColors')
assertFrozen(resolvedDefault.variants, 'resolvedDefault.variants')
assertFrozen(resolvedDefault.icons, 'resolvedDefault.icons')

// 顶级赋值 / 嵌套字段赋值 / 数组元素修改 / push / 新增属性均失败（冻结，而非访问 undefined）。
assert.throws(() => { DEFAULT_LIGHT_TOKENS.color.pageBackground = '#ff0000' }, TypeError, 'top-level token mutation throws')
assert.throws(() => { DEFAULT_LIGHT_TOKENS.widget.color = '#ff0000' }, TypeError, 'nested field assignment throws')
assert.throws(() => { DEFAULT_LIGHT_TOKENS.widget.chartColors[0] = '#ff0000' }, TypeError, 'chartColors element mutation throws')
assert.throws(() => { DEFAULT_LIGHT_TOKENS.widget.chartColors.push('#ff0000') }, TypeError, 'chartColors push throws')
assert.throws(() => { DEFAULT_LIGHT_TOKENS.newKey = 1 }, TypeError, 'adding property to frozen token throws')
assert.throws(() => { DEFAULT_DARK_TOKENS.icon.defaultColor = '#ff0000' }, TypeError, 'dark token mutation throws')
assert.throws(() => { defaultThemeContextValue.tokens.widget.chartColors[0] = '#ff0000' }, TypeError, 'default context chartColors mutation throws')
assert.throws(() => { defaultThemeContextValue.tokens.color.pageBackground = '#ff0000' }, TypeError, 'default context nested token mutation throws')
assert.throws(() => { resolvedDefault.tokens.widget.chartColors[0] = '#ff0000' }, TypeError, 'fallbackResolved chartColors mutation throws')
assert.throws(() => { resolvedDefault.variants.bookmark = 'neon' }, TypeError, 'fallbackResolved variants mutation throws')
assert.throws(() => { resolvedDefault.icons.settings = 'hack' }, TypeError, 'fallbackResolved icons mutation throws')

console.log(`Behavioral tests passed: auto-dark switching, preview coverage + isolation,`)
console.log(`SSR context injection, storage atomicity/rollback, schema-checked serialization,`)
console.log(`icon packs, legacy migration and hardened package validation.`)


function endsWithQuote(line) {
  return line.endsWith(`'`) || line.endsWith('"') || line.endsWith(`';`) || line.endsWith('";')
}

function extractSpec(line) {
  const lastSingle = line.lastIndexOf(`'`)
  const lastDouble = line.lastIndexOf('"')
  const idx = Math.max(lastSingle, lastDouble)
  if (idx === -1)
    return null
  const start = Math.max(line.lastIndexOf(`'`, idx - 1), line.lastIndexOf('"', idx - 1))
  if (start === -1 || start >= idx)
    return null
  return line.slice(start + 1, idx)
}

/* ===================== 模块边界守卫：禁止 widgets ↔ themes 运行时环 ===================== */

{
  const path = await import('node:path')
  const url = await import('node:url')
  const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
  const SRC = path.join(ROOT, 'src')
  const fsSync = fs
  const EXT = /\.(?:ts|vue)$/
  function* walk(dir) {
    for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory())
        yield* walk(full)
      else if (EXT.test(entry.name))
        yield full
    }
  }
  function resolveImport(fromFile, spec) {
    let base
    if (spec.startsWith('@/'))
      base = path.join(SRC, spec.slice(2))
    else if (spec.startsWith('.'))
      base = path.resolve(path.dirname(fromFile), spec)
    else return null
    for (const candidate of [base, `${base}.ts`, `${base}.vue`, path.join(base, 'index.ts')]) {
      if (fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile() && EXT.test(candidate))
        return candidate
    }
    return null
  }
  const graph = new Map()
  for (const file of walk(SRC)) {
    const code = fsSync.readFileSync(file, 'utf8')
    const edges = []
    // 确定性逐行扫描：跳过 import type，收集运行时导入目标（含多行语句）
    const lines = code.split('\n')
    let skipping = false
    for (const rawLine of lines) {
      const trimmed = rawLine.trim()
      if (!skipping && trimmed.startsWith('import ')) {
        if (/^import\s+type\b/.test(trimmed))
          continue
        skipping = !endsWithQuote(trimmed)
        if (skipping) continue
        const spec = extractSpec(trimmed)
        const target = spec && resolveImport(file, spec)
        if (target)
          edges.push(target)
        continue
      }
      if (skipping) {
        if (!endsWithQuote(trimmed))
          continue
        skipping = false
        const spec = extractSpec(trimmed)
        const target = spec && resolveImport(file, spec)
        if (target)
          edges.push(target)
        continue
      }
    }
    graph.set(file, edges)
  }
  // 只检查跨包边：widgets 内部既有的 capabilities↔context 环不在本次守卫范围
  const crossEdge = (from, to) =>
    (from.includes('/widgets/') && to.includes('/themes/')) || (from.includes('/themes/') && to.includes('/widgets/'))
  const violations = []
  for (const [from, edges] of graph) {
    for (const to of edges) {
      const forward = reach(to, from)
      if (forward && crossEdge(from, to)) violations.push(`${from} -> ${to} -> ... -> ${from}`)
    }
  }
  function reach(start, target) {
    const seen = new Set()
    const stack = [start]
    while (stack.length) {
      const v = stack.pop()
      if (v === target) return true
      if (seen.has(v)) continue
      seen.add(v)
      for (const w of graph.get(v) ?? []) stack.push(w)
    }
    return false
  }
  assert.equal(violations.length, 0, `runtime import cycles between widgets and themes detected:\n${violations.join('\n')}`)
}

/* --------------------------------- 输出 --------------------------------- */

console.log(`Validated theme registry: ${fixture.selections.length} shared wire samples,`)
console.log('registration/quarantine/migration/serialize flows, package security, provider wiring and storage isolation.')
