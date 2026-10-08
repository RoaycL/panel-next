import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

// Loads a source file with its imports replaced by the given fixture names.
async function load(file, fixture, key) {
  const source = fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  globalThis[key] = fixture
  const js = ts.transpileModule(`const { ${Object.keys(fixture).join(', ')} } = globalThis.${key};\n${source}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

// The revision cursor never moves backwards for the same account.
let accountId = 1
const revisionApi = await load('src/sync/revision.ts', {
  isSyncRevision: value => typeof value === 'string' && /^\d+$/.test(value),
  getRuntime: () => ({ getServerOrigin: () => 'https://panel.test' }),
  useAuthStore: () => ({ userInfo: { id: accountId } }),
}, 'revisionFixture')
revisionApi.setSyncRevision('10')
revisionApi.setSyncRevision('7')
assert.equal(revisionApi.getSyncRevision(), '10', 'A stale bootstrap must not roll the cursor back')
revisionApi.setSyncRevision('12')
assert.equal(revisionApi.getSyncRevision(), '12')
accountId = 2
revisionApi.setSyncRevision('3')
assert.equal(revisionApi.getSyncRevision(), '3', 'Another account starts from its own revision')

// mutationPost: serialized writes, rebase over unrelated changes, real conflicts stay conflicts.
let serverRevision = 5
let clientRevision = '5'
let inFlight = 0
let maxInFlight = 0
let conflicts = 0
const sent = []
let changes = []
const fixture = {
  HttpRequestError: class extends Error {},
  getSyncRevision: () => clientRevision,
  setSyncRevision: (value) => { clientRevision = value },
  notifySyncConflict: () => { conflicts++ },
  isSyncRevision: value => typeof value === 'string' && /^\d+$/.test(value),
  getBootstrap: async () => ({ code: 0, data: { revision: String(serverRevision) } }),
  getRuntime: () => ({ kind: 'web' }),
  useAuthStore: () => ({ userInfo: { id: 1 } }),
  enqueueOfflineMutation: async () => {},
  fetchChangesSince: async since => ({ hasMore: false, fromRevision: since, currentRevision: String(serverRevision), changes: changes.filter(change => Number(change.revision) > Number(since)) }),
  trackSyncActivity: task => task(),
  post: async ({ url, data }) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise(resolve => setTimeout(resolve, 5))
    inFlight--
    sent.push({ url, expectedRevision: data.expectedRevision })
    if (data.expectedRevision !== String(serverRevision))
      return { code: 1502, msg: 'conflict' }
    serverRevision++
    return { code: 0, data: { revision: String(serverRevision), result: url } }
  },
}
const { mutationPost } = await load('src/api/panel/mutation.ts', fixture, 'mutationFixture')

// Two writes from one page at once: both succeed, never in flight together.
const [first, second] = await Promise.all([
  mutationPost('/panel/userConfig/set', { panel: { a: 1 } }),
  mutationPost('/panel/itemIcon/edit', { id: 3, title: 'x' }),
])
assert.equal(first.code, 0)
assert.equal(second.code, 0)
assert.equal(maxInFlight, 1, 'Writes from one page must be sent one at a time')
assert.equal(conflicts, 0)

// Another tab changed a different item: retried on the new revision silently.
serverRevision++
changes = [{ revision: String(serverRevision), resourceType: 'item', resourceId: '9', operation: 'upsert', data: { itemIconGroupId: 2 } }]
const rebased = await mutationPost('/panel/itemIcon/edit', { id: 3, title: 'y' })
assert.equal(rebased.code, 0, 'A change to another item is not a conflict')
assert.equal(conflicts, 0)

// Another device changed the same item: still a conflict.
serverRevision++
changes = [{ revision: String(serverRevision), resourceType: 'item', resourceId: '3', operation: 'upsert', data: { itemIconGroupId: 2 } }]
const conflicted = await mutationPost('/panel/itemIcon/edit', { id: 3, title: 'z' })
assert.equal(conflicted.code, 1502, 'A change to the same item stays a conflict')
assert.equal(conflicts, 1)

console.log('Sync revision is monotonic per account; writes are serialized and only same-resource changes conflict.')
