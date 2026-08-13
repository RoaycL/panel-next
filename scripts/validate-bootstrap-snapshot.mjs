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

const changesSource = fs.readFileSync(new URL('../src/sync/changes.ts', import.meta.url), 'utf8')
const changesWithoutImports = changesSource
  .replace(/^import .*$/gm, '')
  .replace(/export async function fetchChangesSince[\s\S]*$/, '')
  .replaceAll('isSyncRevision', 'globalThis.__isSyncRevision')
globalThis.__isSyncRevision = isSyncRevision
const { isChangesResponseV1 } = await importTypeScript(changesWithoutImports, 'changes.ts')
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

console.log('Validated bootstrap snapshot, revision cursor, changes page, and bounded retry')
