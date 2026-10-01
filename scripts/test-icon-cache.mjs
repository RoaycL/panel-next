import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const source = readFileSync(resolve('src/icons/localImageCache.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const stored = new Map()
let fetchCount = 0
let online = true

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return online } } })
globalThis.caches = {
  open: async () => ({
    match: async key => stored.get(key)?.clone(),
    put: async (key, response) => { stored.set(key, response.clone()) },
    delete: async key => stored.delete(key),
  }),
}
globalThis.fetch = async (url) => {
  fetchCount++
  if (url.endsWith('/not-image'))
    return new Response('<html>not an image</html>', { headers: { 'Content-Type': 'text/html' } })
  if (url.endsWith('/too-large'))
    return new Response(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/png' }))
  return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
}

const firstPage = await import(`${moduleUrl}#first-page`)
const iconUrl = 'https://panel.example.com/uploads/bookmark.png'
const first = await firstPage.getLocalIconImage(iconUrl)
assert.equal(first?.persisted, true)
assert.match(first.url, /^blob:/)
assert.equal(fetchCount, 1, 'the first icon should download once')
assert.equal((await firstPage.getLocalIconImage(iconUrl))?.url, first.url)
assert.equal(fetchCount, 1, 'same-page use should reuse the object URL')

online = false
const nextPage = await import(`${moduleUrl}#next-page`)
const offline = await nextPage.getLocalIconImage(iconUrl)
assert.equal(offline?.persisted, true)
assert.equal(fetchCount, 1, 'a new offline page should read browser storage without downloading')
assert.equal(await nextPage.getLocalIconImage('https://panel.example.com/uploads/missing.png'), null)

online = true
assert.equal(await nextPage.getLocalIconImage('https://panel.example.com/not-image'), null)
assert.equal(await nextPage.getLocalIconImage('https://panel.example.com/too-large'), null)
assert.equal(stored.size, 1, 'non-images and oversized responses must not persist')
nextPage.configureIconCachePermission(async () => false)
const beforeDenied = fetchCount
assert.equal(await nextPage.getLocalIconImage('https://third-party.example/favicon.ico'), null)
assert.equal(fetchCount, beforeDenied, 'unauthorized image reads must not generate cross-origin network requests')
assert.equal((await nextPage.getCachedIconImage(iconUrl))?.persisted, true, 'cached icons remain available without network permission')

console.log('Icon cache checks passed: one-time download, offline reuse, and invalid response rejection.')
