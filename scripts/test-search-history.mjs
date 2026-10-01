import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync('src/runtime/searchHistory.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { addSearchHistory, normalizeSearchHistory } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
assert.deepEqual(normalizeSearchHistory([' test ', 'test', '', 42, 'x'.repeat(201)]), ['test'])
assert.deepEqual(addSearchHistory(['one', 'two'], ' two '), ['two', 'one'])
assert.equal(normalizeSearchHistory(Array.from({ length: 20 }, (_, i) => `${i}`)).length, 10)
assert.deepEqual(normalizeSearchHistory(null), [])
for (const file of ['src/views/extension/index.vue', 'src/components/deskModule/SearchBox/index.vue']) {
  const view = fs.readFileSync(file, 'utf8')
  assert.doesNotMatch(view, /<datalist|:list=/)
  assert.match(view, /autocomplete="off"/)
  assert.match(view, /SearchHistoryPanel/)
  assert.match(view, /isComposing/)
  assert.match(view, /border: 0 !important/)
}
assert.match(fs.readFileSync('src/views/extension/components/UserHubModal.vue', 'utf8'), /保留搜索历史/)
assert.ok(fs.existsSync('src/assets/svg-icons/panel-next-timer.svg'))
console.log('Search history normalization, deduplication, limits, custom dropdown, input reset and IME guards passed.')
