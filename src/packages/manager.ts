import { ref } from 'vue'
import { getRuntime } from '@/runtime'
import { ThemeRegistry, themeRegistry } from '@/themes/registry'
import { computePackageDigest, themePackageToDefinition, validateThemePackage } from '@/themes/themePackage'
import type { ThemePackageManifestV1 } from '@/themes/themePackage'
import { widgetRegistry, WidgetRegistry } from '@/widgets/registry'
import type { WidgetDefinition } from '@/widgets/types'
import { downloadPackage, validatePackageUrl } from '@/runtime/packageDownload'
import { parsePluginPackage } from './pluginPackage'
import type { PluginPackage } from './pluginPackage'

export type PackageKind = 'theme' | 'plugin'
export interface InstalledPackage {
  kind: PackageKind
  id: string
  version: number
  name: string
  author: string
  digest: string
  source: string | null
  installedAt: string
  manifest: ThemePackageManifestV1 | PluginPackage
}

const STORAGE_KEY = 'PANEL_NEXT_INSTALLED_PACKAGES_V1'
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024
const MAX_STORAGE_BYTES = 4 * 1024 * 1024
export const packageRevision = ref(0)
export const installedPackages = ref<InstalledPackage[]>([])
export const packageLoadErrors = ref<string[]>([])
let pending: Promise<unknown> = Promise.resolve()

export function inspectPackage(raw: string, source: string | null = null): InstalledPackage {
  if (new TextEncoder().encode(raw).length > MAX_PACKAGE_BYTES)
    throw new Error('安装包超过 2 MB 限制')
  if (source)
    source = validatePackageUrl(source).href
  const manifest = JSON.parse(raw)
  let kind: PackageKind
  let id: string
  let version: number
  let name: string
  let author: string
  if (manifest?.format === 'panel-next-theme-package') {
    const errors = validateThemePackage(manifest)
    if (errors.length)
      throw new Error(errors.join('；'))
    // v1 installation uses token/icon-name data only; don't pretend unused assets work.
    if (Object.keys(manifest.assets ?? {}).length)
      throw new Error('当前安装格式仅支持设计变量和图标名称；暂不支持附带图片／字体资源')
    if (!Number.isSafeInteger(manifest.theme.version) || manifest.theme.version > 1000)
      throw new Error('主题版本必须在 1–1000 之间')
    new ThemeRegistry().register(themePackageToDefinition(manifest))
    kind = 'theme'
    ;({ id, version } = manifest.theme)
    name = manifest.theme.meta.name
    author = manifest.theme.meta.author ?? ''
  }
  else {
    const plugin = parsePluginPackage(manifest)
    kind = 'plugin'
    ;({ id, version, name } = plugin.plugin)
    author = plugin.plugin.author ?? ''
    new WidgetRegistry().register(pluginDefinition(plugin))
  }
  return { kind, id, version, name, author, digest: computePackageDigest(manifest), source, installedAt: new Date().toISOString(), manifest }
}

function pluginDefinition(manifest: PluginPackage): WidgetDefinition {
  const p = manifest.plugin
  return {
    type: p.id, currentVersion: p.version,
    meta: { title: p.name, description: p.description },
    size: { default: { ...p.size }, min: { columns: 1, rows: 1 }, max: { columns: 4, rows: 2 } },
    configSchema: { parse: () => ({}) }, defaultConfig: () => ({}),
    migrations: Object.fromEntries(Array.from({ length: p.version - 1 }, (_, i) => [i + 1, () => ({})])),
    load: () => import('./RemoteDataWidget.vue').then(module => module.default),
  }
}

function registerPackage(item: InstalledPackage) {
  if (item.kind === 'theme') {
    const definition = themePackageToDefinition(item.manifest as ThemePackageManifestV1)
    // Data themes have no executable config schema; preserve config across version upgrades.
    definition.migrations = Object.fromEntries(Array.from({ length: item.version - 1 }, (_, i) => [i + 1, (config: unknown) => config]))
    themeRegistry.replacePackage(definition)
  }
  else {
    widgetRegistry.replacePackage(pluginDefinition(item.manifest as PluginPackage))
  }
}

function readPackages(): InstalledPackage[] {
  const raw = getRuntime().storage.getItem(STORAGE_KEY)
  if (!raw)
    return []
  if (new TextEncoder().encode(raw).length > MAX_STORAGE_BYTES)
    throw new Error('已安装包记录超过容量限制，请先导出并清理')
  const data = JSON.parse(raw)
  if (data?.schemaVersion !== 1 || !Array.isArray(data.packages) || data.packages.length > 50)
    throw new Error('已安装包记录格式错误，原始记录已保留')
  return data.packages.map((stored: InstalledPackage) => {
    const verified = inspectPackage(JSON.stringify(stored.manifest), stored.source)
    if (stored.id !== verified.id || stored.kind !== verified.kind || stored.digest !== verified.digest)
      throw new Error('安装包记录校验失败，原始记录已保留')
    return { ...verified, installedAt: stored.installedAt }
  })
}

function applyPackages(next: InstalledPackage[]) {
  for (const old of installedPackages.value) {
    if (!next.some(item => item.kind === old.kind && item.id === old.id)) {
      if (old.kind === 'theme') themeRegistry.removePackage(old.id)
      else widgetRegistry.removePackage(old.id)
    }
  }
  for (const item of next)
    registerPackage(item)
  installedPackages.value = next
  packageRevision.value++
}

export function initializePackages() {
  const refresh = () => {
    try {
      applyPackages(readPackages())
      packageLoadErrors.value = []
    }
    catch (error) {
      packageLoadErrors.value = [error instanceof Error ? error.message : String(error)]
    }
  }
  refresh()
  getRuntime().storage.subscribe?.((event) => {
    if (event.key === STORAGE_KEY)
      refresh()
  })
}

function mutate(operation: (current: InstalledPackage[]) => InstalledPackage[]) {
  const task = pending.then(async () => {
    const storage = getRuntime().storage
    const next = operation(readPackages())
    const serialized = JSON.stringify({ schemaVersion: 1, packages: next })
    if (next.length > 50 || new TextEncoder().encode(serialized).length > MAX_STORAGE_BYTES)
      throw new Error('安装包已达到容量限制（最多 50 个，共 4 MB）')
    const before = storage.getItem(STORAGE_KEY)
    try {
      storage.setItem(STORAGE_KEY, serialized)
      await storage.flush?.()
    }
    catch (error) {
      if (before === null) storage.removeItem(STORAGE_KEY)
      else storage.setItem(STORAGE_KEY, before)
      await storage.flush?.().catch(() => {})
      throw error
    }
    applyPackages(next)
  })
  pending = task.catch(() => {})
  return task
}

export async function installPackage(candidate: InstalledPackage) {
  // Revalidate the candidate at commit time; UI objects are not trusted.
  const verified = inspectPackage(JSON.stringify(candidate.manifest), candidate.source)
  return mutate((current) => {
    const old = current.find(item => item.kind === verified.kind && item.id === verified.id)
    if (old && verified.version <= old.version)
      throw new Error('只能安装更高版本；不允许覆盖同版本或降级')
    const existing = verified.kind === 'theme' ? themeRegistry.get(verified.id) : widgetRegistry.get(verified.id)
    if (existing && !old)
      throw new Error('该标识已经被源码内置扩展占用')
    return [...current.filter(item => item.kind !== verified.kind || item.id !== verified.id), verified]
  })
}

export function removePackage(kind: PackageKind, id: string) {
  return mutate(current => current.filter(item => item.kind !== kind || item.id !== id))
}

export async function fetchPackage(url: string, expected?: InstalledPackage): Promise<InstalledPackage> {
  const result = inspectPackage(await downloadPackage(url), url)
  if (expected && (result.kind !== expected.kind || result.id !== expected.id))
    throw new Error('更新包标识不匹配，已拒绝安装')
  if (expected && result.version < expected.version)
    throw new Error('远程版本低于已安装版本，已拒绝降级')
  if (expected && result.version === expected.version && result.digest !== expected.digest)
    throw new Error('同版本内容被修改，请发布者递增版本号')
  return result
}
