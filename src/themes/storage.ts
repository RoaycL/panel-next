import type { ThemeSelection } from './types'
import { getRuntime } from '@/runtime'
import { readExtensionAppearance, saveExtensionAppearance } from '@/runtime/extensionAppearance'
import { set as setUserConfig } from '@/api/panel/userConfig'
import { enqueueAppearanceSave } from './appearanceSaveQueue'
import { cloneJson } from './clone'

/**
 * 主题选择的双端存储绑定（产品边界：双端分别保存、互不覆盖）：
 * - Web：保存在 panelConfig.theme，通过现有 expectedRevision mutation 同步服务端；
 * - Extension：仅保存在 EXTENSION_APPEARANCE_KEY 本地外观载荷中，
 *   不读取也不回写 Web 的 panelConfig.theme 服务端副本。
 *
 * 保存语义（对比旧实现的修复）：
 * - 保存前不再保留整份快照用于「失败回滚」，也不在成功后用保存前的整份 nextConfig 覆盖
 *   Store —— 因为在 await 期间其他操作可能修改了 panelConfig 的其他字段（logoText/壁纸/
 *   widget 等），整份覆盖会把它们冲掉，整份回滚更是会抹掉保存期间的新修改。
 * - 持久化只在服务端/存储确认「最新整份配置 + 新 theme」后，把确认过的 theme 以字段级
 *   merge 的方式合并进「当前最新的 store.panelConfig」：其他字段的并发修改得以保留。
 * - 对完整 panelConfig 使用 compare-and-swap（CAS）：保存期间任一字段发生变化都会基于
 *   最新完整配置重试；若 theme 本身变化，则切换为“保留较新 theme”的重同步模式。
 * - 任何失败（Web 服务端拒绝 / 网络 / 1502 冲突 / 扩展存储 flush 失败）都不修改 Store、
 *   不更新 Last Known Good、不返回成功。
 * - 整个保存经统一外观保存队列串行化，避免同一账号多个整份配置请求并发交错。
 *
 * 隔离状态必须来自 registry.loadSelection().quarantined / isQuarantinedSelection，
 * 由调用方显式传入，禁止用「存在 theme 字段」推断。
 */

export interface ThemeStoreLike {
  panelConfig: Panel.panelConfig
}

export interface ThemePersistDeps {
  getStore: () => ThemeStoreLike
  readExtensionAppearance: () => Panel.panelConfig | null
  saveExtensionAppearance: (config: Panel.panelConfig) => Promise<boolean>
  setUserConfig: (req: Panel.userConfig) => Promise<{ code: number, msg?: string }>
}

export interface ThemePersistRequest {
  surface: 'web' | 'extension'
  /**
   * 调用方必须先经 registry.serialize()（严格模式）得到的序列化结果。
   * 传入 null 表示「丢弃待保存数据」（仅用于清理损坏的隔离数据），
   * 不论旧数据处于何种状态，新选择的出口校验都不允许被降级。
   */
  serialized: ThemeSelection | null
}

export interface ThemePersistResult {
  ok: boolean
  /** 显式丢弃（serialized=null）时置 true：跳过写入且不触碰 Store。 */
  skipped?: boolean
  /** 保存期间配置持续变化或 theme 被并发修改：不会覆盖较新的本地状态。 */
  conflict?: boolean
  error?: unknown
}

function defaultDeps(): ThemePersistDeps {
  // 延迟导入避免测试环境拉起 Pinia/网络栈。
  return {
    getStore: () => usePanelStateLike(),
    readExtensionAppearance,
    saveExtensionAppearance,
    setUserConfig: req => setUserConfig(req),
  }
}

let storeAccessor: (() => ThemeStoreLike) | null = null

/** 由应用入口注册真实的 Pinia store 访问器（避免 storage.ts 反向依赖具体 store 模块）。 */
export function registerThemeStoreAccessor(accessor: () => ThemeStoreLike): void {
  storeAccessor = accessor
}

function usePanelStateLike(): ThemeStoreLike {
  if (!storeAccessor)
    throw new Error('Theme store accessor is not registered.')
  return storeAccessor()
}

/**
 * 保存主题选择（见模块注释的语义说明）。
 * 显式丢弃（serialized=null）直接跳过；其余经统一外观保存队列串行化后执行。
 */
export async function persistThemeSelection(
  request: ThemePersistRequest,
  deps: ThemePersistDeps = defaultDeps(),
): Promise<ThemePersistResult> {
  const { serialized } = request
  if (!serialized)
    return { ok: true, skipped: true }

  return enqueueAppearanceSave(async () => {
    try {
      if (request.surface === 'extension' && getRuntime().kind === 'extension')
        return await persistExtensionAppearance(deps, serialized)
      return await persistWebAppearance(deps, serialized)
    }
    catch (error) {
      // 不修改 Store（无乐观更新）、不更新 Last Known Good。
      return { ok: false, error }
    }
  })
}

/** CAS 并发冲突后的最多重同步次数；耗尽后保留本地状态并要求用户显式重试。 */
const MAX_THEME_CONFLICT_RESYNC = 3

/** Web 端：服务端确认后才把确认的 theme 合并进最新 Store。 */
async function persistWebAppearance(
  deps: ThemePersistDeps,
  serialized: ThemeSelection,
): Promise<ThemePersistResult> {
  let attempt = 0
  let themeConflicted = false
  for (;;) {
    const store = deps.getStore()
    // 必须深克隆基线：Pinia 允许嵌套字段原地修改，仅保存对象引用无法检测这种变化。
    const baseline = cloneJson(store.panelConfig)
    const nextConfig = cloneJson(themeConflicted
      ? baseline
      : { ...baseline, theme: serialized })
    const response = await deps.setUserConfig({ panel: nextConfig })
    if (response.code !== 0)
      return { ok: false, error: new Error(response.msg || `userConfig/set failed with code ${response.code}`) }

    // 完整配置稳定：本次远端写入与当前 Store 同源，可以安全完成。
    if (samePanelConfig(store.panelConfig, baseline)) {
      if (!themeConflicted) {
        store.panelConfig = { ...store.panelConfig, theme: serialized }
        return { ok: true }
      }
      // 较新 theme 已完整重同步到远端；不覆盖 Store，由 UI 提示用户确认当前状态。
      return { ok: false, conflict: true, error: new Error('appearance changed concurrently; latest local state was preserved') }
    }

    // 只有 theme 发生结构变化时才放弃最初选择；其他字段变化继续携带用户确认的 theme
    // 与最新完整配置重试，从而让服务端和 Store 同时保留两边修改。
    if (!sameThemeSelection(store.panelConfig.theme, baseline.theme))
      themeConflicted = true
    if (++attempt >= MAX_THEME_CONFLICT_RESYNC)
      return { ok: false, conflict: true, error: new Error('appearance kept changing concurrently; latest local state remains unsaved, retry after changes settle') }
  }
}

/** Extension 端：仅写入 EXTENSION_APPEARANCE_KEY；saveExtensionAppearance 自带字节级去重。 */
async function persistExtensionAppearance(
  deps: ThemePersistDeps,
  serialized: ThemeSelection,
): Promise<ThemePersistResult> {
  let attempt = 0
  let themeConflicted = false
  for (;;) {
    const store = deps.getStore()
    const baseline = cloneJson(store.panelConfig)
    const persisted = cloneJson(deps.readExtensionAppearance() ?? {})
    // Store 是当前 UI 真相，持久化载荷仅从旧 appearance 补保留字段；每轮都重新读取最新值。
    const merged = cloneJson(themeConflicted
      ? { ...persisted, ...baseline }
      : { ...persisted, ...baseline, theme: serialized }) as Panel.panelConfig
    const ok = await deps.saveExtensionAppearance(merged)
    if (!ok)
      return { ok: false, error: new Error('Failed to save extension appearance.') }
    if (samePanelConfig(store.panelConfig, baseline)) {
      if (!themeConflicted) {
        store.panelConfig = { ...store.panelConfig, theme: serialized }
        return { ok: true }
      }
      return { ok: false, conflict: true, error: new Error('appearance changed concurrently; latest local state was preserved') }
    }
    if (!sameThemeSelection(store.panelConfig.theme, baseline.theme))
      themeConflicted = true
    if (++attempt >= MAX_THEME_CONFLICT_RESYNC)
      return { ok: false, conflict: true, error: new Error('appearance kept changing concurrently; latest local state remains unsaved, retry after changes settle') }
  }
}

function samePanelConfig(a: Panel.panelConfig, b: Panel.panelConfig): boolean {
  return deepEqualStable(a, b)
}

/** 结构级 theme 比较：null/undefined 相等，对象递归比较且忽略键序与 undefined 值。 */
function sameThemeSelection(a: ThemeSelection | undefined, b: ThemeSelection | undefined): boolean {
  if (a === undefined && b === undefined)
    return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object')
    return a === b
  return deepEqualStable(a, b)
}

function deepEqualStable(a: unknown, b: unknown): boolean {
  if (a === b)
    return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
    return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false
    return a.every((value, index) => deepEqualStable(value, b[index]))
  }
  const aEntries = Object.entries(a as Record<string, unknown>).filter(([, value]) => value !== undefined)
  const bEntries = Object.entries(b as Record<string, unknown>).filter(([, value]) => value !== undefined)
  if (aEntries.length !== bEntries.length)
    return false
  const bMap = new Map(bEntries)
  for (const [key, value] of aEntries) {
    if (!bMap.has(key) || !deepEqualStable(value, bMap.get(key)))
      return false
  }
  return true
}

/** Last Known Good：保存成功后记录；用于诊断与恢复参考。 */
const LKG_STORAGE_KEY = 'PANEL_NEXT_THEME_LKG_V1'

export function saveLastKnownGood(selection: ThemeSelection): void {
  try {
    const runtime = getRuntime()
    runtime.storage.setItem(LKG_STORAGE_KEY, JSON.stringify(selection))
  }
  catch (error) {
    console.warn('[Theme] Failed to record Last Known Good.', error)
  }
}

export function getLastKnownGood(): ThemeSelection | null {
  try {
    const runtime = getRuntime()
    const raw = runtime.storage.getItem(LKG_STORAGE_KEY)
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as ThemeSelection
    return parsed && typeof parsed === 'object' ? parsed : null
  }
  catch {
    return null
  }
}
