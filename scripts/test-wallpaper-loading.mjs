import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const images = new Map()
class FakeImage {
  set src(url) { this.url = url; if (url) images.set(url, this) }
}
globalThis.Image = FakeImage
globalThis.wallpaperWatches = []
const source = fs.readFileSync('src/runtime/wallpaperLoader.ts', 'utf8')
let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
js = js.replace(/import .* from 'vue';?/, `const ref=value=>({value});const watch=(source,callback,options)=>{globalThis.wallpaperWatches.push(callback);if(options?.immediate)callback(source.value)};const onBeforeUnmount=()=>{};`)
const { preloadWallpaper, useLoadedWallpaper } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const timeout = preloadWallpaper('timeout', 5)
await assert.rejects(timeout, /加载超时/)
const failed = preloadWallpaper('invalid')
images.get('invalid').onerror()
await assert.rejects(failed, /加载失败/)
const state = useLoadedWallpaper({ value: 'old' })
images.get('old').onload()
await new Promise(resolve => setImmediate(resolve))
assert.equal(state.displayed.value, 'old')
const change = globalThis.wallpaperWatches[0]
const slow = change('slow')
assert.equal(state.displayed.value, 'old', 'Keep old wallpaper while loading')
const latest = change('latest')
images.get('latest').onload()
await latest
images.get('slow').onload()
await slow
assert.equal(state.displayed.value, 'latest', 'Old responses cannot overwrite the latest selection')
const bad = change('broken')
images.get('broken').onerror()
await bad
assert.equal(state.displayed.value, 'latest', 'Failures preserve the last successful wallpaper')
assert.match(state.error.value, /加载失败/)
await change('')
assert.equal(state.displayed.value, '', 'Explicit clear still removes wallpaper')
const gallery = fs.readFileSync('src/components/common/GallerySelector/index.vue', 'utf8')
assert.match(gallery, /runtime\.resolveUrl\(item\.src\)/)
assert.match(gallery, /await preloadWallpaper\(runtime\.resolveUrl\(url\)\)/)
assert.match(gallery, /generation !== requestGeneration/)
assert.match(gallery, /type="password"/)
console.log('Wallpaper loading, fallback, latest-selection races and gallery URL resolution passed.')
