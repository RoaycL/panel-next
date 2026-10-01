import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const values = new Map()
const auth = { token: 'device', userInfo: { id: 7 } }
const app = { theme: 'dark', language: 'zh-CN', setTheme(value) { this.theme = value }, setLanguage(value) { this.language = value }, $subscribe() {} }
const panel = { networkMode: 2, panelConfig: { maxWidthUnit: '%', backgroundImageSrc: '/day.jpg' }, setNetworkMode(value) { this.networkMode = value }, applyPanelConfig(value) { this.panelConfig = structuredClone(value) }, $subscribe() {} }
const defaults = { clock: true, search: true, searchHistory: ['private query'], pendingWidgetCleanupIds: ['local.cleanup'], pageLayouts: {}, contentLayout: { schemaVersion: 1, widgets: [] } }
let revision = '1', cloud = { maxWidthUnit: '%', backgroundImageSrc: '/day.jpg' }, posts = 0, offline = false, origin = 'https://panel.test', hook
const runtime = { kind: 'extension', getServerOrigin: () => origin, storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), flush: async () => {} } }
const fixture = {
  ref: value => ({ value }), getRuntime: () => runtime, useAuthStore: () => auth, useAppStore: () => app, usePanelState: () => panel,
  EXTENSION_APPEARANCE_KEY: 'appearance', EXTENSION_WIDGETS_KEY: 'widgets',
  readExtensionWidgets: () => JSON.parse(values.get('widgets') || JSON.stringify(defaults)),
  wallpaperFavoritesKey: (_origin, id) => `favorites:${id}`,
  readWallpaperFavorites: (_storage, key) => JSON.parse(values.get(key) || '[]'),
  onSettingsChanged: listener => { hook = listener },
  getSyncRevision: () => revision, setSyncRevision: value => { revision = value },
  getBootstrap: async () => { if (offline) throw new Error('offline'); return { code: 0, data: { revision, account: { id: auth.userInfo.id }, panel: { config: structuredClone(cloud) } } } },
  mutationPost: async (_url, body, options) => {
    assert.equal(options.queueOnFailure, false, 'Latest settings must not create historic mutation versions')
    posts++; cloud = structuredClone(body.panel); revision = String(BigInt(revision) + 1n)
    return { code: 0 }
  },
  navigator: { onLine: true }, window: { addEventListener() {} }, setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1,
}
globalThis.sharedFixture = fixture
const source = fs.readFileSync('src/runtime/sharedSettings.ts', 'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
const js = ts.transpileModule(`const { ${Object.keys(fixture).join(', ')} } = globalThis.sharedFixture;\n${source}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const api = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
api.initializeSharedSettings()
const initialPreferences = { schemaVersion: 1, networkMode: 2, app: { theme: 'dark', language: 'zh-CN' }, widgets: defaults, favorites: [] }
api.receiveSharedSettings({ ...cloud, sharedPreferences: initialPreferences }, 7, '1')
panel.networkMode = 0
panel.panelConfig.backgroundImageSrc = '/new.jpg'
values.set('widgets', JSON.stringify({ ...defaults, clock: false, sidebarAutoHide: false, clockHourCycle: '12' }))
values.set('favorites:7', JSON.stringify([{ url: '/liked.jpg', title: 'Liked' }]))
hook()
assert.equal(api.settingsSyncState.value, 'pending')
const pendingKeys = [...values.keys()].filter(key => key.startsWith('PANEL_NEXT_LATEST_SETTINGS_V1:') && !key.endsWith(':accepted'))
assert.equal(pendingKeys.length, 1)
const staged = JSON.parse(values.get(pendingKeys[0]))
assert.deepEqual(staged.preferences.widgets.searchHistory, [])
assert.deepEqual(staged.preferences.widgets.pendingWidgetCleanupIds, [])
// Refreshing during the debounce cannot undo the local pending state.
const kept = api.receiveSharedSettings({ ...cloud, sharedPreferences: initialPreferences }, 7, '1')
assert.equal(kept.backgroundImageSrc, '/new.jpg')
assert.equal(panel.networkMode, 0)
await api.flushLatestSettings()
assert.equal(posts, 1)
assert.equal(cloud.sharedPreferences.widgets.clock, false)
assert.equal(cloud.sharedPreferences.widgets.sidebarAutoHide, false)
assert.equal(cloud.sharedPreferences.widgets.clockHourCycle, '12')
assert.equal(cloud.sharedPreferences.favorites[0].url, '/liked.jpg')
assert.equal(api.settingsSyncState.value, 'synced')
assert.equal(values.has(pendingKeys[0]), false)
// A stale cached bootstrap cannot undo an accepted settings save.
assert.equal(api.receiveSharedSettings({ ...cloud, backgroundImageSrc: '/stale.jpg' }, 7, '1').backgroundImageSrc, '/new.jpg')
// Offline modifications replace one pending slot; reconnect sends only newest.
offline = true
panel.panelConfig.backgroundImageSrc = '/offline-a.jpg'; hook(); await api.flushLatestSettings()
panel.panelConfig.backgroundImageSrc = '/offline-b.jpg'; hook(); await api.flushLatestSettings()
assert.equal(JSON.parse(values.get(pendingKeys[0])).panel.backgroundImageSrc, '/offline-b.jpg')
offline = false
await api.flushLatestSettings()
assert.equal(cloud.backgroundImageSrc, '/offline-b.jpg')
const fresh = { ...cloud, sharedPreferences: { ...cloud.sharedPreferences, networkMode: 1, app: { theme: 'light', language: 'en-US' } } }
api.receiveSharedSettings(fresh, 7, String(BigInt(revision) + 1n))
assert.equal(panel.networkMode, 1); assert.equal(app.theme, 'light'); assert.equal(app.language, 'en-US')
const beforePosts = posts
hook(); await api.flushLatestSettings()
assert.equal(posts, beforePosts, 'Applying remote settings must not echo them back')
// Scope changes cannot send another account/server pending state.
panel.panelConfig.backgroundImageSrc = '/pending-private.jpg'; hook()
auth.userInfo.id = 8
await api.flushLatestSettings()
assert.equal(posts, beforePosts)
origin = 'https://other.test'
await api.flushLatestSettings()
assert.equal(posts, beforePosts)
auth.token = ''
hook(); await api.flushLatestSettings()
assert.equal(posts, beforePosts)
delete globalThis.sharedFixture
console.log('Latest settings, all preference fields, offline coalescing, stale cache protection, echo suppression and scope isolation passed.')
