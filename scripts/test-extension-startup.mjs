import assert from 'node:assert/strict'
import fs from 'node:fs'
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const main = read('src/main.ts')
assert.doesNotMatch(main, /await useAuthStore\(\)\.(upgradeLegacyExtensionSession|refreshSession)/, 'network authentication must not block mounting')
assert.match(read('src/router/permission.ts'), /!cachedExtensionHome && authStore.authMode/)
const dashboard = read('src/views/extension/index.vue')
assert.match(dashboard, /await loadCachedSnapshot\(\)[\s\S]*requestAnimationFrame[\s\S]*await refreshBootstrap\(\)/)
assert.match(read('extension/newtab.html'), /prefers-color-scheme: dark/)
assert.match(read('src/components/common/ItemIcon/index.vue'), /getCachedIconImage\(source\)/)
assert.match(read('src/plugins/modalFocus.ts'), /flush: 'sync'/)
assert.match(read('src/api/sync.ts'), /timeout: 35000/)
console.log('Extension startup: cached-first paint, bounded authentication, icon read and focus safeguards passed')
