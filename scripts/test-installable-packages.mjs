import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { compileFunction } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const cache = new Map()
const values = new Map()
let failFlush = false
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
  flush: async () => { if (failFlush) throw new Error('simulated disk failure') },
}
const runtime = { getRuntime: () => ({ kind: 'web', storage }) }
function load(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const source = fs.readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const resolve = (name) => {
    if (name === '@/runtime') return runtime
    if (!name.startsWith('.') && !name.startsWith('@/')) return require(name)
    let target = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(file), name)
    if (target.endsWith('.vue')) return { default: {} }
    if (!target.endsWith('.ts')) target += '.ts'
    return load(target)
  }
  compileFunction(compiled, ['require', 'module', 'exports'])(resolve, module, module.exports)
  return module.exports
}

const manager = load('src/packages/manager.ts')
const themes = load('src/themes/registry.ts').themeRegistry
const widgets = load('src/widgets/registry.ts').widgetRegistry
const downloader = load('src/runtime/packageDownload.ts')
const theme = {
  format: 'panel-next-theme-package', formatVersion: 1,
  theme: { id: 'test.acrylic', version: 1, meta: { name: 'Test Acrylic' }, wallpapers: { light: '/package-day.jpg', dark: '/package-night.jpg' }, tokens: { dark: { color: { surface: 'rgba(40,20,80,0.5)' }, effect: { blur: '8px' } } } },
}
const wallpaper = load('src/themes/wallpaper.ts')
const schema = load('src/themes/schema.ts')
let selection = themes.createSelection('core.default', 'auto')
assert.equal(wallpaper.resolveThemeWallpaper(selection, undefined, 'dark', '/legacy.jpg'), '/legacy.jpg')
selection = wallpaper.withThemeWallpaper(selection, 'light', '/day.jpg')
selection = wallpaper.withThemeWallpaper(selection, 'dark', '/night.jpg')
assert.equal(wallpaper.resolveThemeWallpaper(selection, undefined, 'light'), '/day.jpg')
assert.equal(wallpaper.resolveThemeWallpaper(selection, undefined, 'dark'), '/night.jpg')
assert.deepEqual(themes.serialize(selection).wallpapers, selection.wallpapers)
assert.equal(wallpaper.resolveThemeWallpaper(undefined, { wallpapers: { light: '/shared.jpg' } }, 'dark'), '/shared.jpg')
assert.equal(wallpaper.resolveThemeWallpaper(wallpaper.withThemeWallpaper(selection, 'dark', ''), undefined, 'dark', '/legacy.jpg'), '')
assert.equal(schema.validateThemeWireSelection(selection), null)
assert.ok(schema.validateThemeWallpapers({ light: 'javascript:alert(1)' }))
assert.ok(schema.validateThemeWallpapers({ dark: '//evil.invalid/a.jpg' }))
assert.ok(schema.validateThemeWallpaperMap({ 'core.default': { light: 'data:image/png;base64,abc' } }))
const sharedSelection = wallpaper.withThemeWallpaper(selection, 'light', '/shared.jpg', true)
assert.equal(wallpaper.resolveThemeWallpaper(sharedSelection, undefined, 'dark'), '/shared.jpg')
const other = { ...selection, themeId: 'test.other' }
assert.equal(wallpaper.resolveThemeWallpaper(other, { wallpapers: { dark: '/package.jpg' } }, 'dark'), '/package.jpg')
const plugin = {
  format: 'panel-next-widget-package', formatVersion: 1,
  plugin: { id: 'test.links', version: 1, name: 'Quick links', size: { columns: 2, rows: 1 }, blocks: [{ kind: 'link', label: 'Example', url: 'https://example.com' }] },
}
const clone = value => structuredClone(value)
const inspect = value => manager.inspectPackage(JSON.stringify(value))

manager.initializePackages()
await manager.installPackage(inspect(theme))
assert.equal(themes.get('test.acrylic').version, 1)
assert.deepEqual(themes.get('test.acrylic').wallpapers, theme.theme.wallpapers, 'Installed package preserves light/dark wallpaper declarations')
await manager.installPackage(inspect(plugin))
assert.equal(widgets.get('test.links').currentVersion, 1)
assert.equal(manager.installedPackages.value.length, 2)
manager.initializePackages()
assert.equal(manager.installedPackages.value.length, 2, 'persisted packages restore on startup')
await assert.rejects(manager.installPackage(inspect(plugin)), /更高版本/)
const upgrade = clone(plugin)
upgrade.plugin.version = 2
await manager.installPackage(inspect(upgrade))
assert.equal(widgets.get('test.links').currentVersion, 2)
assert.deepEqual(widgets.loadLayout({ schemaVersion: 1, widgets: [widgets.create('test.links', 'w.links', { column: 0, row: 0 })] }).layout.widgets[0].size, { columns: 2, rows: 1 })
const before = [...values.entries()]
failFlush = true
const brokenSave = clone(plugin)
brokenSave.plugin.version = 3
await assert.rejects(manager.installPackage(inspect(brokenSave)), /disk failure/)
assert.deepEqual([...values.entries()], before, 'failed persistence rolls back storage')
assert.equal(widgets.get('test.links').currentVersion, 2, 'failed persistence keeps old runtime')
failFlush = false
await manager.removePackage('plugin', 'test.links')
assert.equal(widgets.get('test.links'), null)
assert.equal(manager.installedPackages.value.length, 1)
assert.throws(() => themes.removePackage('core.default'), /内置/)

for (const change of [
  p => { p.plugin.id = 'core.evil' },
  p => { p.plugin.script = 'alert(1)' },
  p => { p.plugin.blocks[0].url = 'javascript:alert(1)' },
  p => { p.plugin.blocks[0].html = '<script>evil</script>' },
  p => { p.plugin.size.columns = 5 },
  p => { p.plugin.version = 1001 },
]) {
  const bad = clone(plugin); change(bad)
  assert.throws(() => inspect(bad))
}
const invalidTheme = clone(theme)
invalidTheme.theme.tokens.dark.color.surface = 'url(https://evil.test)'
assert.throws(() => inspect(invalidTheme))
assert.throws(() => manager.inspectPackage('x'.repeat(2 * 1024 * 1024 + 1)), /2 MB/)
for (const url of ['http://example.com/p.json', 'https://localhost/p.json', 'https://127.0.0.1/p.json', 'https://[::1]/p.json', 'https://user:secret@example.com/p.json', 'https://example.local/p.json'])
  assert.throws(() => downloader.validatePackageUrl(url))

const originalFetch = globalThis.fetch
let fetchOptions
globalThis.fetch = async (_url, options) => {
  fetchOptions = options
  return new Response(JSON.stringify(theme), { headers: { 'content-type': 'application/json' } })
}
const remote = await manager.fetchPackage('https://example.com/theme.json')
assert.equal(remote.id, 'test.acrylic')
assert.equal(fetchOptions.credentials, 'omit')
assert.equal(fetchOptions.redirect, 'error')
assert.equal(fetchOptions.referrerPolicy, 'no-referrer')
assert.deepEqual(fetchOptions.headers, { Accept: 'application/json' })
await assert.rejects(manager.fetchPackage('https://example.com/theme.json', { ...remote, id: 'wrong.id' }), /不匹配/)
await assert.rejects(manager.fetchPackage('https://example.com/theme.json', { ...remote, digest: 'tampered' }), /同版本/)
globalThis.fetch = async () => new Response('too large', { headers: { 'content-length': String(3 * 1024 * 1024) } })
await assert.rejects(manager.fetchPackage('https://example.com/theme.json'), /2 MB/)
globalThis.fetch = originalFetch
await manager.removePackage('theme', 'test.acrylic')
assert.equal(themes.get('test.acrylic'), undefined)
assert.deepEqual(manager.installedPackages.value, [])
console.log('Installable packages passed: import/install/update/delete/restart, storage rollback, URL/security limits, credentials isolation and update identity checks.')
