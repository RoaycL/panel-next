import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

const presetsSource = fs.readFileSync(new URL('../src/icons/presets.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(presetsSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { ICON_PRESETS, createPresetIcon, resolveBundledPresetId } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const sources = JSON.parse(fs.readFileSync(new URL('../src/assets/brand-icons/sources.json', import.meta.url), 'utf8'))
assert.equal(ICON_PRESETS.length, 40)
assert.equal(sources.length, ICON_PRESETS.length)
assert.equal(new Set(sources.map(item => item.id)).size, sources.length)
for (const preset of ICON_PRESETS) {
  const entry = sources.find(item => item.id === preset.id)
  assert.ok(entry, `Missing official icon for ${preset.id}`)
  assert.match(entry.source, /^https:\/\//)
  assert.match(entry.file, new RegExp(`^${preset.id}\\.(svg|png|ico|webp|jpg|gif)$`))
  const bytes = fs.readFileSync(new URL(`../src/assets/brand-icons/${entry.file}`, import.meta.url))
  assert.ok(bytes.length > 100)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256)
  if (entry.file.endsWith('.svg')) assert.doesNotMatch(bytes.toString(), /<(?:script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|javascript:)/i)
  assert.equal(resolveBundledPresetId(createPresetIcon(preset)), preset.id, 'Explicit bundled marker also renders on the web')
  assert.equal(resolveBundledPresetId(null, preset.url), preset.id)
  assert.equal(resolveBundledPresetId({ itemType: 1, text: preset.mark, backgroundColor: preset.color }, preset.url), preset.id)
  assert.equal(resolveBundledPresetId({ itemType: 1, text: 'Custom', backgroundColor: '#aabbcc' }, preset.url), '')
  assert.equal(resolveBundledPresetId({ itemType: 1, text: preset.mark, backgroundColor: '#aabbcc' }, preset.url), '')
  assert.equal(resolveBundledPresetId({ itemType: 2, src: 'https://example.com/custom.png' }, preset.url), '')
  assert.equal(resolveBundledPresetId({ itemType: 3, text: 'mdi:heart' }, preset.url), '')
  if (preset.sprite) assert.equal(resolveBundledPresetId({ itemType: 3, text: preset.sprite.replace('-', ':') }, preset.url), preset.id)
}
assert.equal(resolveBundledPresetId({ itemType: 3, text: 'brand:../../invalid' }), '')
assert.equal(resolveBundledPresetId(null, 'https://notgoogle.com'), '')
const extension = fs.readFileSync(new URL('../src/views/extension/index.vue', import.meta.url), 'utf8')
assert.equal((extension.match(/class="dashboard-add-icon"/g) || []).length, 1)
assert.doesNotMatch(extension, /showWidgetGallery|<WidgetGalleryModal/)
assert.match(extension, /@add-widget="addExtensionWidget" @done="handleEditSuccess"/)
const center = fs.readFileSync(new URL('../src/views/extension/components/IconGalleryModal.vue', import.meta.url), 'utf8')
assert.match(center, /<WidgetGallery[^>]*embedded/)
assert.match(center, /<EditItem[^>]*embedded/)
assert.match(center, /:close-on-esc="!busy"/)
assert.match(center, /:disabled="busy" size="small"/)
for (const [, name] of center.matchAll(/icon: '([^']+)'|icon="([^" ]+)"/g)) {
  if (name) assert.ok(fs.existsSync(new URL(`../src/assets/svg-icons/${name}.svg`, import.meta.url)), `Missing offline navigation icon: ${name}`)
}
console.log('Validated 40 official bundled icons, legacy-default upgrades, custom-icon preservation and one unified add center')
