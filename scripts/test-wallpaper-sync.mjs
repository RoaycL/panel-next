import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

const values = new Map()
const auth = { token: 'test', userInfo: { id: 1 } }
let online = true
let revision = '10'
let local
let received
let remote = { backgroundImageSrc: 'old.jpg', backgroundBlur: 0, backgroundMaskNumber: 0, logoText: 'Cloud', theme: { mode: 'dark' } }
const snapshot = () => ({ revision, account: { id: 1 }, panel: { config: structuredClone(remote) } })
class HttpRequestError extends Error { retryable = true }
globalThis.wallpaperTest = {
  getRuntime: () => ({ storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), flush: async () => {} }, getServerOrigin: () => 'https://test.invalid' }),
  useAuthStore: () => auth,
  readBootstrapSnapshot: () => ({ data: snapshot() }),
  getBootstrap: async () => { if (!online) throw new HttpRequestError('Offline'); return { code: 0, data: snapshot() } },
  mutationPost: async (_path, data) => { received = data; remote = structuredClone(data.panel); revision = String(BigInt(revision) + 1n); return { code: 0 } },
  getSyncRevision: () => revision,
  setSyncRevision: value => { revision = value },
  isSyncRevision: value => typeof value === 'string' && /^\d+$/.test(value),
  saveExtensionAppearance: async config => { local = structuredClone(config) },
  enqueueAppearanceSave: async task => task(),
  setUserConfig: async data => { received = data; remote = structuredClone(data.panel); revision = String(BigInt(revision) + 1n); return { code: 0 } },
  HttpRequestError,
}
const names = Object.keys(globalThis.wallpaperTest).join(', ')
const source = ['src/sync/wallpaper.ts', 'src/sync/offlineQueue.ts', 'src/sync/conflictResolver.ts', 'src/sync/offlineReplay.ts', 'src/runtime/extensionWallpaper.ts']
  .map(file => fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')).join('\n')
const js = ts.transpileModule(`const { ${names} } = globalThis.wallpaperTest;\n${source}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const api = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const config = { ...remote, logoText: 'Local', backgroundImageSrc: 'new.jpg', backgroundBlur: 3, backgroundMaskNumber: 20 }
assert.equal((await api.saveAndSyncExtensionWallpaper(config)).status, 'synced')
assert.equal(local.logoText, 'Local')
assert.equal(received.panel.logoText, 'Cloud', 'Wallpaper cannot overwrite other cloud appearance fields')
assert.deepEqual(received.panel.theme, { mode: 'dark' })
assert.equal(api.resolveSyncedWallpaper(config, { ...remote, backgroundImageSrc: 'stale.jpg' }, '10', 1).backgroundImageSrc, 'new.jpg', 'Old bootstrap cannot undo accepted save')
assert.equal(api.resolveSyncedWallpaper(config, { ...remote, backgroundImageSrc: 'fresh.jpg' }, '12', 1).backgroundImageSrc, 'fresh.jpg')
assert.equal(api.resolveSyncedWallpaper(config, { ...remote, backgroundImageSrc: '' }, '12', 1).backgroundImageSrc, '', 'Explicit clearing syncs')
assert.equal(api.resolveSyncedWallpaper(config, { logoText: 'legacy' }, '12', 1).backgroundImageSrc, 'new.jpg', 'Legacy missing field preserves local wallpaper')
online = false
assert.equal((await api.saveAndSyncExtensionWallpaper({ ...config, backgroundImageSrc: 'offline-a.jpg' })).status, 'queued')
assert.equal((await api.saveAndSyncExtensionWallpaper({ ...config, backgroundImageSrc: 'offline-b.jpg' })).status, 'queued')
const queue = api.readOfflineQueue(1)
assert.equal(queue.length, 1, 'Latest offline wallpaper coalesces earlier unsent choice')
assert.equal(queue[0].payload.wallpaper.backgroundImageSrc, 'offline-b.jpg')
assert.equal(queue[0].payload.wallpaperBase.backgroundImageSrc, 'new.jpg')
assert.equal(api.resolveSyncedWallpaper(config, remote, '99', 1).backgroundImageSrc, 'offline-b.jpg', 'Pending intent is not overwritten by cloud refresh')
assert.equal(api.readOfflineQueue(2).length, 0, 'Account isolation')
assert.equal(api.readOfflineQueue(1, 'https://another.invalid').length, 0, 'Server isolation')
online = true
remote.logoText = 'Changed on another device'
revision = '20'
let held = false
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_key, task) => {
  assert.equal(held, false, 'Replay must not reacquire its own lock')
  held = true
  try { return await task() }
  finally { held = false }
} } } })
assert.equal((await api.replayOfflineQueue(1)).succeeded, 1, 'Unrelated cloud layout changes do not conflict with wallpaper')
assert.equal(received.panel.logoText, 'Changed on another device', 'Replay merges into latest remote config')
assert.equal(received.panel.backgroundImageSrc, 'offline-b.jpg')
assert.equal(api.readOfflineQueue(1).length, 0)
if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
else delete globalThis.navigator
auth.token = ''
assert.equal((await api.saveAndSyncExtensionWallpaper(config)).status, 'local', 'Guest saves never require login')
assert.equal(api.isWallpaperMutation({ wallpaper: { ...api.pickWallpaper(config), backgroundBlur: NaN } }), false)
delete globalThis.wallpaperTest
console.log('Wallpaper sync regression tests passed.')
