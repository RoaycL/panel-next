import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createUpdateChecker, compareVersions, selectRelease, UPDATE_KEY, UPDATE_ALARM } from '../extension/update-check.mjs'
const release = (version, extra = {}) => ({ tag_name: `v${version}`, prerelease: true, assets: [`panel-next-extension-v${version}.zip`, `panel-next-extension-v${version}.zip.sha256`].map(name => ({ name, size: 100, state: 'uploaded' })), ...extra })
assert.equal(compareVersions('0.0.100', '0.0.99'), 1)
assert.equal(compareVersions('1.0.0', '0.99.99'), 1)
assert.equal(compareVersions('0.0.42', '0.0.42'), 0)
assert.throws(() => compareVersions('invalid', '1.0.0'))
assert.equal(selectRelease([release('0.0.44'), release('0.0.45', { draft: true }), release('0.0.50', { assets: [] }), release('0.0.43')], '0.0.42').version, '0.0.44')
assert.equal(selectRelease([release('1.0.1')], '1.0.0'), null)
assert.equal(selectRelease([release('0.0.42')], '0.0.42'), null)
assert.equal(selectRelease([release('0.0.43', { html_url: 'https://evil.example' })], '0.0.42').releaseUrl, 'https://github.com/RoaycL/panel-next/releases/tag/v0.0.43')
const data = {}
const storage = { async get(key) { return { [key]: data[key] } }, async set(value) { Object.assign(data, value) } }
let calls = 0
let fail = false
let limited = false
const check = createUpdateChecker({ storage, currentVersion: '0.0.42', now: () => 1000000, fetcher: async (url, options) => {
  calls++
  assert.match(url, /^https:\/\/api.github.com\/repos\/RoaycL\/panel-next\/releases/)
  assert.equal(options.credentials, 'omit')
  assert.equal(options.headers.Authorization, undefined)
  if (fail) throw new Error('offline')
  if (limited) return { ok: false, status: 429, headers: { get: () => null } }
  return { ok: true, json: async () => [release('0.0.43')] }
} })
await Promise.all([check(), check()])
assert.equal(calls, 1)
assert.equal(data[UPDATE_KEY].latest.version, '0.0.43')
fail = true
await check()
assert.equal(data[UPDATE_KEY].latest.version, '0.0.43')
assert.ok(data[UPDATE_KEY].error)
fail = false
limited = true
await check()
const before = calls
await check()
assert.equal(calls, before)
data[UPDATE_KEY].retryAfter = 0
const upgraded = createUpdateChecker({ storage, currentVersion: '0.0.43', fetcher: async () => { throw new Error('offline') } })
await upgraded()
assert.equal(data[UPDATE_KEY].latest, null, 'installed updates must not keep an obsolete banner when offline')
assert.equal(data[UPDATE_KEY].currentVersion, '0.0.43')

const savedChrome = globalThis.chrome
const savedFetch = globalThis.fetch
const listeners = {}
let alarm = null
let workerCalls = 0
globalThis.chrome = {
  runtime: { id: 'test-id', getManifest: () => ({ version: '0.0.42' }), onStartup: { addListener: fn => listeners.startup = fn }, onInstalled: { addListener: fn => listeners.installed = fn }, onMessage: { addListener: fn => listeners.message = fn } },
  alarms: { get: async () => alarm, create: (name, options) => { alarm = { name, ...options } }, onAlarm: { addListener: fn => listeners.alarm = fn } },
  storage: { local: { get: async () => ({}), set: async () => {} } },
}
globalThis.fetch = async () => { workerCalls++; return { ok: true, json: async () => [] } }
const flush = () => new Promise(resolve => setImmediate(resolve))
try {
  const worker = fs.readFileSync(new URL('../extension/service-worker.js', import.meta.url), 'utf8').replace("'./update-check.mjs'", JSON.stringify(new URL('../extension/update-check.mjs', import.meta.url).href))
  await import(`data:text/javascript;base64,${Buffer.from(worker).toString('base64')}`)
  await flush()
  assert.equal(alarm.periodInMinutes, 10)
  listeners.startup()
  await flush()
  assert.equal(workerCalls, 1)
  listeners.alarm({ name: UPDATE_ALARM })
  await flush()
  assert.equal(workerCalls, 2)
  listeners.alarm({ name: 'unrelated' })
  assert.equal(workerCalls, 2)
  alarm = null
  listeners.installed()
  await flush()
  assert.equal(alarm.periodInMinutes, 10)
  assert.equal(workerCalls, 3)
  assert.equal(listeners.message({ type: 'panel-next-check-update' }, { id: 'other-extension' }, () => {}), undefined)
  await new Promise(resolve => assert.equal(listeners.message({ type: 'panel-next-check-update' }, { id: 'test-id' }, resolve), true))
  assert.equal(workerCalls, 4)
}
finally { globalThis.chrome = savedChrome; globalThis.fetch = savedFetch }
console.log('Extension updates: version selection, retry, startup, alarms and messaging passed')
