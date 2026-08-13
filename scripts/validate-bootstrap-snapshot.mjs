import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/sync/bootstrapSnapshot.ts', import.meta.url), 'utf8')
async function importTypeScript(sourceText, fileName) {
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
    reportDiagnostics: true,
  })
  const diagnostics = transpiled.diagnostics ?? []
  if (diagnostics.length) {
    const messages = diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    throw new Error(`Unable to transpile ${fileName}:\n${messages.join('\n')}`)
  }
  const encodedModule = Buffer.from(transpiled.outputText).toString('base64')
  return import(`data:text/javascript;base64,${encodedModule}`)
}
const {
  BOOTSTRAP_SNAPSHOT_CACHE_VERSION,
  MAX_BOOTSTRAP_SNAPSHOT_BYTES,
  isBootstrapResponseV1,
  isSyncRevision,
  parseBootstrapSnapshot,
  serializeBootstrapSnapshot,
} = await importTypeScript(source, 'bootstrapSnapshot.ts')

function validBootstrap() {
  return {
    schemaVersion: 1,
    revision: '9',
    generatedAt: '2026-08-09T12:00:00Z',
    account: {
      id: 7,
      username: 'snapshot@example.com',
      name: 'Snapshot',
      headImage: '',
      role: 2,
      mail: '',
      status: 1,
    },
    panel: {
      revision: '8',
      config: { logoText: 'Panel Next' },
      searchEngine: {},
      groups: [{
        id: 11,
        createTime: '2026-08-09T12:00:00Z',
        updateTime: '2026-08-09T12:00:00Z',
        icon: '',
        title: 'Apps',
        description: '',
        sort: 1,
        revision: '7',
        items: [{
          id: 12,
          createTime: '2026-08-09T12:00:00Z',
          updateTime: '2026-08-09T12:00:00Z',
          icon: { itemType: 1, src: 'app.svg', text: '', backgroundColor: '' },
          title: 'App',
          url: 'https://example.com',
          lanUrl: '',
          description: '',
          openMethod: 2,
          sort: 1,
          revision: '6',
          itemIconGroupId: 11,
        }],
      }],
    },
  }
}

const data = validBootstrap()
const raw = serializeBootstrapSnapshot(data, 'https://panel.example.com', 7, '2026-08-09T12:01:00Z')
assert.ok(raw)
const parsed = parseBootstrapSnapshot(raw, 'https://panel.example.com', 7)
assert.equal(parsed?.data.panel.groups[0].items[0].title, 'App')
assert.equal(parseBootstrapSnapshot(raw, 'https://other.example.com', 7), null)
assert.equal(parseBootstrapSnapshot(raw, 'https://panel.example.com', 8), null)
assert.equal(serializeBootstrapSnapshot(validBootstrap(), 'https://panel.example.com/path', 7), null)

const wrongSchema = validBootstrap()
wrongSchema.schemaVersion = 2
assert.equal(isBootstrapResponseV1(wrongSchema), false)

const invalidRevision = validBootstrap()
invalidRevision.panel.groups[0].items[0].revision = '01'
assert.equal(serializeBootstrapSnapshot(invalidRevision, 'https://panel.example.com', 7), null)

const mismatchedGroup = validBootstrap()
mismatchedGroup.panel.groups[0].items[0].itemIconGroupId = 99
assert.equal(isBootstrapResponseV1(mismatchedGroup), false)
assert.equal(serializeBootstrapSnapshot(validBootstrap(), 'https://panel.example.com', 8), null)
assert.equal(parseBootstrapSnapshot('x'.repeat(MAX_BOOTSTRAP_SNAPSHOT_BYTES + 1), 'https://panel.example.com', 7), null)
assert.equal(parseBootstrapSnapshot('{not-json', 'https://panel.example.com', 7), null)
assert.equal(isSyncRevision('9007199254740993'), true)
assert.equal(isSyncRevision('9223372036854775807'), true)
assert.equal(isSyncRevision('9223372036854775808'), false)
assert.equal(isSyncRevision('01'), false)
assert.equal(isSyncRevision('-1'), false)

const legacy = JSON.parse(raw)
legacy.cacheVersion = 1
delete legacy.cursorRevision
const migrated = parseBootstrapSnapshot(JSON.stringify(legacy), 'https://panel.example.com', 7)
assert.equal(BOOTSTRAP_SNAPSHOT_CACHE_VERSION, 2)
assert.equal(migrated?.cacheVersion, 2)
assert.equal(migrated?.cursorRevision, '9')
const corruptCursor = JSON.parse(raw)
corruptCursor.cursorRevision = '8'
assert.equal(parseBootstrapSnapshot(JSON.stringify(corruptCursor), 'https://panel.example.com', 7), null)

const changesSource = fs.readFileSync(new URL('../src/sync/changes.ts', import.meta.url), 'utf8')
const changesWithoutImports = changesSource
  .replace(/^import .*$/gm, '')
globalThis.__bootstrapValidators = await importTypeScript(source, 'bootstrapSnapshot.ts')
const validatorsPrelude = 'const { isBootstrapGroup, isBootstrapItem, isBootstrapResponseV1, isSyncRevision } = globalThis.__bootstrapValidators\n'
const { applyChangesPage, isChangesResponseV1, synchronizeBootstrap } = await importTypeScript(`${validatorsPrelude}${changesWithoutImports}`, 'changes.ts')
const validChanges = {
  schemaVersion: 1,
  fromRevision: '9',
  nextRevision: '11',
  currentRevision: '12',
  hasMore: true,
  changes: [
    { revision: '10', resourceType: 'group', resourceId: '11', operation: 'upsert', changedAt: '2026-08-10T12:00:00Z', data: { title: 'Apps' } },
    { revision: '11', resourceType: 'item', resourceId: '12', operation: 'delete', changedAt: '2026-08-10T12:00:01Z', data: null },
  ],
}
assert.equal(isChangesResponseV1(validChanges), true)
assert.equal(isChangesResponseV1({ ...validChanges, nextRevision: '10' }), false)
assert.equal(isChangesResponseV1({ ...validChanges, changes: [...validChanges.changes].reverse() }), false)
assert.equal(isChangesResponseV1({ ...validChanges, changes: [{ ...validChanges.changes[1], data: {} }] }), false)
assert.equal(isChangesResponseV1({ ...validChanges, changes: [validChanges.changes[1]], fromRevision: '9' }), false)
assert.equal(isChangesResponseV1({ ...validChanges, hasMore: false }), false)

const timestamp = '2026-08-10T12:00:00Z'
const panelPage = {
  schemaVersion: 1,
  fromRevision: '9',
  nextRevision: '11',
  currentRevision: '11',
  hasMore: false,
  changes: [{
    revision: '10', resourceType: 'panel', resourceId: '7', operation: 'upsert', changedAt: timestamp,
    data: { revision: '10', config: { logoText: 'Synced' }, searchEngine: { default: 'google' } },
  }, {
    revision: '11', resourceType: 'group', resourceId: '11', operation: 'upsert', changedAt: timestamp,
    data: { ...validBootstrap().panel.groups[0], title: 'Renamed', revision: '11', items: [] },
  }],
}
const sourceBeforeApply = validBootstrap()
const appliedPanel = applyChangesPage(sourceBeforeApply, panelPage)
assert.equal(sourceBeforeApply.revision, '9')
assert.equal(sourceBeforeApply.panel.groups[0].title, 'Apps')
assert.equal(appliedPanel?.revision, '11')
assert.equal(appliedPanel?.panel.config.logoText, 'Synced')
assert.equal(appliedPanel?.panel.groups[0].title, 'Renamed')
assert.equal(appliedPanel?.panel.groups[0].items.length, 1)

const itemPage = {
  schemaVersion: 1,
  fromRevision: '11',
  nextRevision: '13',
  currentRevision: '13',
  hasMore: false,
  changes: [{
    revision: '12', resourceType: 'group', resourceId: '13', operation: 'upsert', changedAt: timestamp,
    data: { ...validBootstrap().panel.groups[0], id: 13, title: 'Second', revision: '12', items: [] },
  }, {
    revision: '13', resourceType: 'item', resourceId: '12', operation: 'upsert', changedAt: timestamp,
    data: { ...validBootstrap().panel.groups[0].items[0], itemIconGroupId: 13, revision: '13' },
  }],
}
const movedItem = applyChangesPage(appliedPanel, itemPage)
assert.equal(movedItem?.panel.groups.find(group => group.id === 11)?.items.length, 0)
assert.equal(movedItem?.panel.groups.find(group => group.id === 13)?.items[0].id, 12)

const brokenPage = structuredClone(itemPage)
brokenPage.changes[1].data.itemIconGroupId = 99
assert.equal(applyChangesPage(appliedPanel, brokenPage), null)
assert.equal(appliedPanel.revision, '11')
assert.equal(appliedPanel.panel.groups.length, 1)

const firstPaged = { ...panelPage, nextRevision: '10', currentRevision: '11', hasMore: true, changes: [panelPage.changes[0]] }
const secondPaged = { ...panelPage, fromRevision: '10', changes: [panelPage.changes[1]] }
const pages = [firstPaged, secondPaged]
const synchronized = await synchronizeBootstrap(validBootstrap(), async cursor => {
  const page = pages.shift()
  assert.equal(page?.fromRevision, cursor)
  return page ?? null
})
assert.equal(synchronized?.data.revision, '11')
assert.equal(synchronized?.pages, 2)
assert.equal(synchronized?.changes, 2)

const offlineSource = validBootstrap()
let offlineCalls = 0
await assert.rejects(() => synchronizeBootstrap(offlineSource, async () => {
  offlineCalls++
  if (offlineCalls === 1)
    return firstPaged
  throw new Error('offline')
}), /offline/)
assert.equal(offlineSource.revision, '9')
assert.equal(offlineSource.panel.config.logoText, 'Panel Next')

const retrySource = fs.readFileSync(new URL('../src/sync/retry.ts', import.meta.url), 'utf8')
const { retryNetworkOperation } = await importTypeScript(retrySource, 'retry.ts')
let attempts = 0
const waited = []
const retried = await retryNetworkOperation(async () => {
  attempts++
  if (attempts < 3)
    throw new Error('offline')
  return 'online'
}, [0, 100, 300], async delay => waited.push(delay))
assert.deepEqual(retried, { ok: true, value: 'online', attempts: 3 })
assert.deepEqual(waited, [100, 300])

const exhausted = await retryNetworkOperation(async () => {
  throw new Error('offline')
}, [0, 1, 2], async () => {})
assert.deepEqual(exhausted, { ok: false, attempts: 3 })

console.log('Validated cache migration, atomic incremental sync, corruption fallback, and bounded offline retry')
