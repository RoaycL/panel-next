import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

const typesSource = fs.readFileSync(new URL('../src/widgets/types.ts', import.meta.url), 'utf8')
  .replace(/^import type .*$/gm, '')
const constantsSource = fs.readFileSync(new URL('../src/widgets/constants.ts', import.meta.url), 'utf8')
const schemaSource = fs.readFileSync(new URL('../src/sdk/configSchema.ts', import.meta.url), 'utf8')
  .replace(/^import type .*$/gm, '')
const stackSource = fs.readFileSync(new URL('../src/widgets/stack.ts', import.meta.url), 'utf8')
  .replace(/^import type .*$/gm, '')
  .replace(/^import \{ MAX_WIDGET_STACK_SIZE \} from '\.\/types'\r?\n/gm, '')
const registrySource = fs.readFileSync(new URL('../src/widgets/registry.ts', import.meta.url), 'utf8')
  .replace(/^import type \{[\s\S]*?\} from '\.\/types'\r?\n/, '')
  .replace(/^import \{ WIDGET_ID_PATTERN, WIDGET_TYPE_PATTERN \} from '\.\/constants'\r?\n/, '')
  .replace(/^import \{ .* \} from '\.\/types'\r?\n/, '')
  .replace(/^import \{ normalizeWidgetPositions, normalizeWidgetStacks \} from '\.\/stack'\r?\n/gm, '')
const transpiled = ts.transpileModule(`${typesSource}\n${constantsSource}\n${schemaSource}\n${stackSource}\n${registrySource}`, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'widget-registry.ts',
  reportDiagnostics: true,
})
if (transpiled.diagnostics?.length)
  throw new Error('Unable to transpile widget registry')
const encoded = Buffer.from(transpiled.outputText).toString('base64')
const { WidgetRegistry, WIDGET_LAYOUT_SCHEMA_VERSION, serializeWidgetLayout, validateWidgetWireInstance, widgetRegistry, buildWidgetDisplayGroups, moveWidgetWithinStack, stackWidgets, unstackWidget, resolveWidgetSize, resizeInstanceToWithinBounds, resizeInstanceWithinBounds, color, defineConfigSchema, integer, number, url } = await import(`data:text/javascript;base64,${encoded}`)

const generatedSchema = defineConfigSchema({
  count: integer({ default: 2, min: 1, max: 5, label: 'Count' }),
  opacity: number({ default: 0.5, min: 0, max: 1 }),
  endpoint: url({ default: 'https://example.com' }),
  accent: color({ default: '#12abef' }),
})
assert.deepEqual(generatedSchema.parse({ count: 3, opacity: 0.8, endpoint: 'https://example.org/a', accent: 'white', ignored: true }), {
  count: 3, opacity: 0.8, endpoint: 'https://example.org/a', accent: 'white',
})
assert.equal(generatedSchema.fields.count.kind, 'integer')
assert.throws(() => generatedSchema.parse({ endpoint: 'javascript:alert(1)' }), /HTTP\(S\)/)
assert.throws(() => generatedSchema.parse({ opacity: Number.NaN }), /finite/)

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
  widgets: [
    created,
    { ...created },
    // 结构合法但本端未注册 → 满足传输契约，进入隔离区
    { id: 'future', type: 'future.widget', version: 1, position: { column: 1, row: 2 }, size: { columns: 2, rows: 2 }, config: {} },
    // 缺少 position/size → 违反服务端契约，必须丢弃而非隔离
    { id: 'future.bare', type: 'future.widget', version: 1 },
  ],
})
assert.equal(result.layout.widgets.length, 1)
assert.deepEqual(result.droppedWidgetIds, ['clock.main', 'future.bare'])
assert.equal(result.quarantinedWidgets.length, 1)
assert.equal(result.quarantinedWidgets[0].id, 'future')
assert.equal(result.issues.length, 3)
assert.equal(result.issues.find(issue => issue.id === 'future')?.preserved, true)
assert.equal(result.issues.find(issue => issue.id === 'future.bare')?.preserved, false)
assert.throws(() => registry.loadLayout({ schemaVersion: 2, widgets: [] }), /Unsupported/)
assert.throws(() => registry.create('core.clock', '../unsafe', { column: 0, row: 0 }), /invalid widget id/)
assert.throws(() => new WidgetRegistry().register({ ...definition, type: 'test.invalid-capability', capabilities: ['camera'] }), /capabilities/)
assert.throws(() => registry.loadLayout({ schemaVersion: 1, widgets: Array.from({ length: 101 }, () => created) }), /limits/)

const discreteDefinition = {
  ...definition,
  type: 'test.discrete-size',
  size: {
    default: { columns: 2, rows: 1 },
    min: { columns: 2, rows: 1 },
    max: { columns: 4, rows: 2 },
    supportedSizes: [{ columns: 2, rows: 1 }, { columns: 4, rows: 2 }],
  },
}
widgetRegistry.register(discreteDefinition)
assert.deepEqual(resolveWidgetSize('test.discrete-size', { columns: 3, rows: 2 }), { columns: 4, rows: 2 })
const discrete = widgetRegistry.create('test.discrete-size', 'discrete.main', { column: 0, row: 0 })
assert.equal(resizeInstanceToWithinBounds(discrete, { columns: 7, rows: 4 }), true)
assert.deepEqual(discrete.size, { columns: 4, rows: 2 })
assert.equal(resizeInstanceWithinBounds(discrete, 'columns', 1), false)
const stackMembers = [
  widgetRegistry.create('test.discrete-size', 'stack.a', { column: 0, row: 0 }),
  widgetRegistry.create('test.discrete-size', 'stack.b', { column: 0, row: 1 }),
  widgetRegistry.create('test.discrete-size', 'stack.c', { column: 0, row: 2 }),
]
const stackId = stackWidgets(stackMembers, 'stack.b', 'stack.a')
assert.match(stackId, /^stack\./)
assert.equal(buildWidgetDisplayGroups(stackMembers).length, 2)
assert.deepEqual(stackMembers.slice(0, 2).map(instance => instance.stack?.order), [0, 1])
assert.equal(moveWidgetWithinStack(stackMembers, 'stack.b', -1), true)
assert.equal(stackMembers.find(instance => instance.id === 'stack.b')?.stack?.order, 0)
const stackedLayout = serializeWidgetLayout(stackMembers)
assert.equal(stackedLayout.widgets[0].position.row, stackedLayout.widgets[1].position.row)
assert.equal(unstackWidget(stackMembers, 'stack.b'), true)
assert.equal(stackMembers.every(instance => instance.stack === undefined), true)
widgetRegistry.register({
  ...discreteDefinition,
  type: 'test.discrete-horizontal',
  size: { ...discreteDefinition.size, resize: 'horizontal' },
})
const discreteHorizontal = widgetRegistry.create('test.discrete-horizontal', 'discrete.horizontal', { column: 0, row: 0 })
assert.equal(resizeInstanceToWithinBounds(discreteHorizontal, { columns: 8, rows: 4 }), false)
assert.deepEqual(discreteHorizontal.size, discreteDefinition.size.default)
widgetRegistry.register({
  ...definition,
  type: 'test.vertical-only',
  size: { ...definition.size, resize: 'vertical' },
})
const verticalOnly = widgetRegistry.create('test.vertical-only', 'vertical.main', { column: 0, row: 0 })
assert.equal(resizeInstanceToWithinBounds(verticalOnly, { columns: 4, rows: 2 }), true)
assert.deepEqual(verticalOnly.size, { columns: definition.size.default.columns, rows: 2 })
widgetRegistry.register({
  ...definition,
  type: 'test.resize-step',
  size: {
    default: { columns: 1, rows: 1 },
    min: { columns: 1, rows: 1 },
    max: { columns: 4, rows: 2 },
    step: { columns: 3, rows: 1 },
  },
})
const stepped = widgetRegistry.create('test.resize-step', 'stepped.main', { column: 0, row: 0 })
assert.equal(resizeInstanceWithinBounds(stepped, 'columns', 1), true)
assert.equal(stepped.size.columns, 4)
assert.throws(() => new WidgetRegistry().register({
  ...discreteDefinition,
  type: 'test.invalid-discrete-size',
  size: { ...discreteDefinition.size, default: { columns: 3, rows: 2 } },
}), /default size is not supported/)

const builtins = fs.readFileSync(new URL('../src/widgets/builtins.ts', import.meta.url), 'utf8')
for (const match of builtins.matchAll(/size: \{ default: \{ columns: (\d+), rows: (\d+) \}, min: \{ columns: (\d+), rows: (\d+) \}, max: \{ columns: (\d+), rows: (\d+) \} \}/g)) {
  const [, dc, dr, mc, mr, xc, xr] = match.map(Number)
  assert.ok(xc <= 4 && xr <= 2, 'every built-in must fit within 4×2')
  assert.ok(mc <= dc && dc <= xc && mr <= dr && dr <= xr)
}
assert.equal([...builtins.matchAll(/size: \{ default:/g)].length, 10)
assert.throws(() => new WidgetRegistry().register({ ...definition, type: 'test.oversize', size: { ...definition.size, max: { columns: 5, rows: 2 } } }), /host grid limits/)
const largeLegacy = registry.loadLayout({ schemaVersion: 1, widgets: [{ ...created, size: { columns: 12, rows: 24 } }] })
assert.deepEqual(largeLegacy.layout.widgets[0].size, { columns: 4, rows: 2 })
assert.deepEqual(largeLegacy.layout.widgets[0].config, created.config)
const defineSource = fs.readFileSync(new URL('../src/widgets/define.ts', import.meta.url), 'utf8')
const contextSource = fs.readFileSync(new URL('../src/widgets/context.ts', import.meta.url), 'utf8')
const host = fs.readFileSync(new URL('../src/widgets/WidgetHost.vue', import.meta.url), 'utf8')
const stackHost = fs.readFileSync(new URL('../src/widgets/WidgetStackHost.vue', import.meta.url), 'utf8')
const settingsModal = fs.readFileSync(new URL('../src/widgets/WidgetSettingsModal.vue', import.meta.url), 'utf8')
const extension = fs.readFileSync(new URL('../src/views/extension/index.vue', import.meta.url), 'utf8')
const extensionAppearance = fs.readFileSync(new URL('../src/runtime/extensionAppearance.ts', import.meta.url), 'utf8')
const builtInTypes = ['core.clock', 'core.date', 'core.search', 'core.weather', 'core.trending', 'core.countdown', 'core.workday', 'core.notes', 'core.calendar', 'core.todo']
for (const type of builtInTypes)
  assert.ok(builtins.includes(`type: '${type}'`), `missing built-in ${type}`)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/ClockWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/DateWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/SearchWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/WeatherWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/TrendingWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/CountdownWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/WorkdayWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/NotesWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/CalendarWidget\.vue'\)/)
assert.match(builtins, /load: \(\) => import\('\.\/builtin\/TodoWidget\.vue'\)/)
// 标准化接口：内置组件全部走 defineWidget + 声明式 schema，日期格式约束收敛在 field.isoDate
assert.match(builtins, /defineConfigSchema</)
assert.match(schemaSource, /\\d\{4\}-\\d\{2\}-\\d\{2\}/)
assert.match(builtins, /field\.isoDate\(/)
for (const type of builtInTypes)
  assert.ok(new RegExp(`type: '${type}'.*?meta: \\{ title:`).test(builtins.replace(/\n/g, '§')), `missing meta for built-in ${type}`)
assert.match(defineSource, /export function defineWidget/)
assert.match(contextSource, /export function useWidgetContext/)
assert.match(contextSource, /useWidgetStorage/)
const networkSource = fs.readFileSync(new URL('../src/widgets/network.ts', import.meta.url), 'utf8')
const actionsSource = fs.readFileSync(new URL('../src/widgets/actions.ts', import.meta.url), 'utf8')
const capabilitiesSource = fs.readFileSync(new URL('../src/widgets/capabilities.ts', import.meta.url), 'utf8')
// 能力授权层：统一使用纯函数 assertContextCapability 闸门
assert.match(capabilitiesSource, /export function assertCapability/)
assert.match(capabilitiesSource, /export function assertContextCapability/)
assert.match(capabilitiesSource, /export function hasContextCapability/)
assert.match(capabilitiesSource, /export class WidgetPermissionError/)
assert.match(networkSource, /assertContextCapability\(context, 'network'\)/)
assert.match(actionsSource, /assertContextCapability\(context, 'clipboard'\)/)
assert.match(actionsSource, /assertContextCapability\(context, 'geolocation'\)/)
assert.match(contextSource, /assertContextCapability\(context, 'storage'\)/)
// 动作层必须走运行时导航适配器，禁止 window.open
assert.doesNotMatch(actionsSource, /window\.open/)
assert.match(actionsSource, /openUrl\(/)
assert.doesNotMatch(builtins, /apiKey/)
assert.match(builtins, /serializeWidgetLayout/)
assert.match(registrySource, /WIDGET_LAYOUT_SCHEMA_VERSION/)
assert.match(builtins, /generateWidgetInstanceId/)
assert.match(host, /definition\.load\(\)/)
// 宿主契约：上下文注入与错误边界
assert.match(host, /WIDGET_CONTEXT_KEY/)
assert.match(host, /onErrorCaptured/)
assert.match(host, /!instance\.hidden/)
assert.match(host, /renderError/)
assert.match(host, /retryLoad/)
assert.match(host, /editMode: props\.editMode/)
assert.match(stackHost, /handleWheel/)
assert.match(stackHost, /handlePointerUp/)
assert.match(stackHost, /widget-stack-indicator/)
assert.match(settingsModal, /configSchema\.fields/)
assert.match(settingsModal, /definition\.value\.configSchema\.parse/)
// The old web widget strip (panelConfig.widgets) moves onto the first page once.
assert.match(extension, /function adoptLegacyWebWidgets\(\)[\s\S]*panelState\.panelConfig\.widgets/)
assert.match(extension, /<WidgetStackHost :instances="item\.group\.members"/)
assert.match(extension, /WidgetSettingsModal/)
assert.match(extension, /widgetRegistry\.create/)
// 扩展端布局编辑器：拖拽/缩放/隐藏能力齐备
assert.match(extension, /VueDraggable/)
assert.match(extension, /extension-widget-handle/)
assert.match(extension, /resizeInstanceToWithinBounds/)
assert.match(extension, /useWidgetGridResize/)
assert.match(extension, /chosen-class="is-dashboard-dragging"/)
assert.match(extension, /class="widget-resize-handle is-corner"/)
assert.match(extension, /toggleExtensionWidgetHidden/)
assert.match(extensionAppearance, /contentLayout: WidgetLayout/)
assert.match(extensionAppearance, /pageLayouts: Record<string, ExtensionPageLayout>/)
assert.match(contextSource, /await storage\.flush/)
assert.match(contextSource, /MAX_WIDGET_STORAGE_TOTAL_BYTES/)

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

// ---- 双端传输契约共享样本：防止 TS 与 Go 校验规则漂移 ----
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/widget-wire-samples.json', import.meta.url), 'utf8'))
for (const sample of fixture.instances) {
  let instance = sample.instance
  if (sample.synthesizeBlob) {
    const blob = String.fromCodePoint(sample.synthesizeBlob.codepoint).repeat(sample.synthesizeBlob.repeat)
    instance = { ...instance, config: { blob } }
  }
  const accepted = validateWidgetWireInstance(instance) === null
  assert.equal(
    accepted,
    sample.expect === 'valid',
    `wire-contract drift on sample "${sample.name}": TS says ${accepted ? 'valid' : 'invalid'}, fixture expects ${sample.expect}`,
  )
}
{
  // 出口兜底：正常实例违规必须阻断保存；隔离实例违规被丢弃且不影响合法输出
  const badLive = { id: 'live.bad', type: 'core.clock', version: 1, position: { column: 0, row: 0 }, size: { columns: 99, rows: 1 } }
  assert.throws(() => serializeWidgetLayout([badLive]), /cannot be saved/)
  // 正常实例重复 ID → 抛错
  const live = { id: 'live.ok', type: 'core.clock', version: 1, position: { column: 0, row: 0 }, size: { columns: 1, rows: 1 }, config: {} }
  assert.throws(() => serializeWidgetLayout([live, { ...live }]), /Duplicate widget id/)
  // 隔离实例违规 / 与现有 ID 冲突 → 丢弃；隔离区内部重复 → 保留第一个
  const badQuarantine = { id: 'q.bad', type: 'acme.future', version: 2, position: { column: 0, row: -5 }, size: { columns: 1, rows: 1 }, config: {} }
  const goodQuarantineA = { id: 'q.good', type: 'acme.future', version: 9, position: { column: 2, row: 4 }, size: { columns: 3, rows: 2 }, config: {} }
  const goodQuarantineB = { ...goodQuarantineA, version: 8 }
  const collidingQuarantine = { id: 'live.ok', type: 'acme.future', version: 9, position: { column: 0, row: 0 }, size: { columns: 1, rows: 1 }, config: {} }
  const layout = serializeWidgetLayout([live], [badQuarantine, collidingQuarantine, goodQuarantineB, goodQuarantineA])
  assert.equal(layout.widgets.length, 2)
  assert.deepEqual(layout.widgets.map(widget => widget.id), ['live.ok', 'q.good'])
}

// 运行新增的 Widget SDK 与扩展端持久化真实行为测试套件
await import('./test-widget-network.mjs')
await import('./test-widget-capabilities.mjs')
await import('./test-extension-persistence.mjs')
await import('./test-request-security.mjs')
await import('./test-package-transaction.mjs')

console.log('Validated widget registry, migrations, wire-contract samples (TS side), all built-in widget definitions, async host, and runtime behavior test suites')
