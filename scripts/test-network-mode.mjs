import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

let loads = false
let fetchWorks = false
class FakeImage { set src(_value) { queueMicrotask(() => loads ? this.onload?.() : this.onerror?.()) } }
globalThis.networkFixture = { Image: FakeImage, fetch: async () => { if (!fetchWorks) throw new Error('blocked'); return { type: 'opaque' } }, setTimeout: (fn, delay) => delay === 1800 ? setImmediate(fn) : 0, clearTimeout: clearImmediate }
const source = fs.readFileSync('src/dashboard/core.ts', 'utf8')
const js = ts.transpileModule(`const { ${Object.keys(globalThis.networkFixture).join(', ')} } = globalThis.networkFixture;\n${source}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const api = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const item = { url: 'https://public.test', lanUrl: 'http://192.168.1.2/app', id: 1 }
assert.equal(await api.resolveItemUrl(item, 0), item.lanUrl)
assert.equal(await api.resolveItemUrl(item, 1), item.url)
assert.equal(await api.resolveItemUrl({ ...item, lanUrl: '' }, 2), item.url)
assert.equal(await api.resolveItemUrl(item, 2), item.url, 'Fast errors must not count as LAN success')
loads = true
const second = { ...item, lanUrl: 'http://192.168.1.3/app' }
assert.equal(await api.resolveItemUrl(second, 2), second.lanUrl, 'Loaded favicon confirms LAN reachability')
loads = false; fetchWorks = true
const third = { ...item, lanUrl: 'http://192.168.1.4/app' }
assert.equal(await api.resolveItemUrl(third, 2), third.lanUrl, 'A page can be reachable even without a favicon')
delete globalThis.networkFixture
console.log('Explicit network modes, missing LAN fallback and failed-probe safety passed.')
