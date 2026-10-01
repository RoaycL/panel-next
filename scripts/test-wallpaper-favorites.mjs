import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync('src/runtime/wallpaperFavorites.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { readWallpaperFavorites, wallpaperFavoritesKey, wallpaperIdentity, writeWallpaperFavorites }
  = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const values = new Map()
let failFlush = false
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), flush: async () => { if (failFlush) throw new Error('quota') } }
const origin = 'https://panel.example.com'
const key = wallpaperFavoritesKey(origin, 1)
const item = { url: '/uploads/a.jpg', thumbnail: '/uploads/a.jpg', title: '壁纸', source: 'private', savedAt: '2026-10-01T00:00:00Z' }
await writeWallpaperFavorites(storage, key, [item])
assert.deepEqual(readWallpaperFavorites(storage, key, origin), [item])
assert.deepEqual(readWallpaperFavorites(storage, wallpaperFavoritesKey(origin, 2), origin), [])
assert.notEqual(key, wallpaperFavoritesKey('https://other.example.com', 1))
assert.notEqual(key, wallpaperFavoritesKey(origin))
assert.equal(wallpaperIdentity(item.url, origin), wallpaperIdentity(`${origin}${item.url}`, origin))
values.set(key, JSON.stringify([item, { ...item, url: `${origin}${item.url}` }, { ...item, url: 'javascript:alert(1)' }, { ...item, thumbnail: 'https://user:secret@evil.example/a' }]))
assert.deepEqual(readWallpaperFavorites(storage, key, origin), [item], 'Invalid images and duplicate relative/absolute URLs are ignored')
await writeWallpaperFavorites(storage, key, [item])
failFlush = true
await assert.rejects(writeWallpaperFavorites(storage, key, []), /quota/)
assert.deepEqual(readWallpaperFavorites(storage, key, origin), [item], 'Persistence failure restores previous favorites')
failFlush = false
await writeWallpaperFavorites(storage, key, [])
assert.deepEqual(readWallpaperFavorites(storage, key, origin), [])
values.set(key, 'invalid JSON')
assert.deepEqual(readWallpaperFavorites(storage, key, origin), [])
const gallery = fs.readFileSync('src/components/common/GallerySelector/index.vue', 'utf8')
assert.match(gallery, /我的喜欢/)
assert.match(gallery, /@click\.stop="toggleFavorite/)
assert.match(gallery, /source === 'favorites'/)
assert.match(gallery, /:aria-pressed="isFavorite/)
assert.ok(fs.existsSync('src/assets/svg-icons/material-symbols-favorite.svg'))
assert.ok(fs.existsSync('src/assets/svg-icons/mdi-heart-outline.svg'))
assert.doesNotMatch(gallery, /material-symbols:favorite(?:-outline)?-rounded/)
console.log('Wallpaper favorites persistence, account/server isolation, deduplication, safe URLs and failure rollback passed.')
