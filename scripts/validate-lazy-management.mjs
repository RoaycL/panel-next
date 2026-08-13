import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync(new URL('../src/views/home/index.vue', import.meta.url), 'utf8')
const barrel = fs.readFileSync(new URL('../src/views/home/components/index.ts', import.meta.url), 'utf8')
const loader = fs.readFileSync(new URL('../src/components/common/AppLoader/index.vue', import.meta.url), 'utf8')
const editor = fs.readFileSync(new URL('../src/views/home/components/EditItem/index.vue', import.meta.url), 'utf8')

assert.doesNotMatch(barrel, /AppStarter|EditItem/)
assert.match(home, /defineAsyncComponent\(\(\) => import\('\.\/components\/AppStarter\/index\.vue'\)\)/)
assert.match(home, /defineAsyncComponent\(\(\) => import\('\.\/components\/EditItem\/index\.vue'\)\)/)
assert.match(home, /<AppStarter v-if="settingModalShow"/)
assert.match(home, /<EditItem v-if="editItemInfoShow"/)
assert.match(loader, /import\(`\.\.\/\.\.\/apps\/\$\{props\.componentName\}\/index\.vue`\)/)
assert.match(editor, /watch\(\(\) => props\.visible,[\s\S]*\{ immediate: true \}\)/)

console.log('Validated lazy dashboard editors, initial state, and management application chunks')
