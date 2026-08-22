import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

const typesSource = fs.readFileSync(new URL('../src/widgets/types.ts', import.meta.url), 'utf8')
  .replace(/^import type .*$/gm, '')
const constantsSource = fs.readFileSync(new URL('../src/widgets/constants.ts', import.meta.url), 'utf8')
const registrySource = fs.readFileSync(new URL('../src/widgets/registry.ts', import.meta.url), 'utf8')
  .replace(/^import type \{[\s\S]*?\} from '\.\/types'\r?\n/, '')
  .replace(/^import \{ WIDGET_ID_PATTERN, WIDGET_TYPE_PATTERN \} from '\.\/constants'\r?\n/, '')
  .replace(/^import \{ WIDGET_LAYOUT_SCHEMA_VERSION \} from '\.\/types'\r?\n/, '')
const transpiled = ts.transpileModule(`${typesSource}\n${constantsSource}\n${registrySource}`, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'widget-registry.ts',
  reportDiagnostics: true,
})
if (transpiled.diagnostics?.length)
  throw new Error('Unable to transpile widget registry')
const encoded = Buffer.from(transpiled.outputText).toString('base64')
const { WidgetRegistry, WIDGET_LAYOUT_SCHEMA_VERSION } = await import(`data:text/javascript;base64,${encoded}`)

const configSchema = {
  parse(value) {
    if (!value || typeof value !== 'object' || typeof value.format !== 'string')
      throw new Error('invalid config')
    return { format: value.format }
  },
}
const definition = {
  type: 'core.clock',
  currentVersion: 2,
  configSchema,
  defaultConfig: () => ({ format: '24h' }),
  size: { default: { columns: 2, rows: 1 }, min: { columns: 1, rows: 1 }, max: { columns: 4, rows: 2 } },
  migrations: { 1: config => ({ format: config.mode ?? '24h' }) },
  load: async () => ({}),
}
const registry = new WidgetRegistry().register(definition)
assert.throws(() => registry.register(definition), /already registered/)
assert.equal(registry.list().length, 1)

const created = registry.create('core.clock', 'clock.main', { column: 0, row: 0 })
assert.equal(created.version, 2)
assert.deepEqual(created.size, { columns: 2, rows: 1 })
assert.deepEqual(created.config, { format: '24h' })

const migrated = registry.migrate({
  id: 'clock.legacy', type: 'core.clock', version: 1,
  position: { column: 3, row: 4 }, size: { columns: 99, rows: 1 }, hidden: true,
  config: { mode: '12h' },
})
assert.equal(migrated.version, 2)
assert.deepEqual(migrated.config, { format: '12h' })
assert.deepEqual(migrated.size, { columns: 4, rows: 1 })

const result = registry.loadLayout({
  schemaVersion: WIDGET_LAYOUT_SCHEMA_VERSION,
  widgets: [created, { ...created }, { id: 'future', type: 'future.widget', version: 1 }],
})
assert.equal(result.layout.widgets.length, 1)
assert.deepEqual(result.droppedWidgetIds, ['clock.main', 'future'])
assert.throws(() => registry.loadLayout({ schemaVersion: 2, widgets: [] }), /Unsupported/)
assert.throws(() => registry.create('core.clock', '../unsafe', { column: 0, row: 0 }), /invalid widget id/)

const builtins = fs.readFileSync(new URL('../src/widgets/builtins.ts', import.meta.url), 'utf8')
const schemaSource = fs.readFileSync(new URL('../src/widgets/schema.ts', import.meta.url), 'utf8')
const defineSource = fs.readFileSync(new URL('../src/widgets/define.ts', import.meta.url), 'utf8')
const contextSource = fs.readFileSync(new URL('../src/widgets/context.ts', import.meta.url), 'utf8')
const host = fs.readFileSync(new URL('../src/widgets/WidgetHost.vue', import.meta.url), 'utf8')
const home = fs.readFileSync(new URL('../src/views/home/index.vue', import.meta.url), 'utf8')
for (const type of ['core.clock', 'core.date', 'core.search', 'core.weather', 'core.trending', 'core.countdown'])
  assert.ok(builtins.includes(`type: '${type}'`), `missing built-in ${type}`)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/ClockWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/DateWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/SearchWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/WeatherWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/TrendingWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/CountdownWidget\.vue'\)/)
// 标准化接口：内置组件全部走 defineWidget + 声明式 schema，日期格式约束收敛在 field.isoDate
assert.match(builtins, /defineConfigSchema</)
assert.match(schemaSource, /\\d\{4\}-\\d\{2\}-\\d\{2\}/)
assert.match(builtins, /field\.isoDate\(\)/)
for (const type of ['core.clock', 'core.date', 'core.search', 'core.weather', 'core.trending', 'core.countdown'])
  assert.ok(new RegExp(`type: '${type}'.*?meta: \\{ title:`).test(builtins.replace(/\n/g, '§')), `missing meta for built-in ${type}`)
assert.match(defineSource, /export function defineWidget/)
assert.match(contextSource, /export function useWidgetContext/)
assert.match(contextSource, /useWidgetStorage/)
assert.doesNotMatch(builtins, /apiKey/)
assert.match(builtins, /serializeWidgetLayout/)
assert.match(builtins, /WIDGET_LAYOUT_SCHEMA_VERSION/)
assert.match(builtins, /generateWidgetInstanceId/)
assert.match(host, /definition\.load\(\)/)
// 宿主契约：上下文注入与错误边界
assert.match(host, /WIDGET_CONTEXT_KEY/)
assert.match(host, /onErrorCaptured/)
assert.match(host, /!instance\.hidden/)
assert.match(home, /<WidgetHost :instance="headerClockWidget"/)
assert.match(home, /<WidgetHost :instance="headerSearchWidget" @item-search="itemFrontEndSearch"/)
assert.match(home, /<WidgetHost :instance="headerWeatherWidget"/)
assert.match(home, /widgetRegistry\.loadLayout/)
assert.match(home, /serializeWidgetLayout/)
assert.match(home, /v-model="widgetInstances"/)
assert.match(home, /handle="\.widget-edit-handle"/)
assert.match(home, /toggleWidgetHidden/)
assert.match(home, /removeWidgetInstance/)
assert.match(home, /resizeWidget/)
assert.match(home, /panelState\.panelConfig\.widgets/)

const trendingApi = fs.readFileSync(new URL('../src/api/trending.ts', import.meta.url), 'utf8')
assert.match(trendingApi, /url: '\/v1\/widgets\/trending'/)
assert.doesNotMatch(trendingApi, /apiKey/)
const trendingWidget = fs.readFileSync(new URL('../src/widgets/builtin/TrendingWidget.vue', import.meta.url), 'utf8')
assert.match(trendingWidget, /target="_blank" rel="noopener noreferrer"/)
assert.doesNotMatch(trendingWidget, /window\.open/)

const countdownWidget = fs.readFileSync(new URL('../src/widgets/builtin/CountdownWidget.vue', import.meta.url), 'utf8')
assert.match(countdownWidget, /repeat === 'yearly'/)
assert.match(countdownWidget, /calendarDaysBetween/)
assert.doesNotMatch(countdownWidget, /window\.open|fetch\(|axios/)

console.log('Validated widget registry, migrations, built-in clock/date/search/weather/trending/countdown, and async host')
