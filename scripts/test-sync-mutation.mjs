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
revisionApi.setSyncRevision('4', { authoritative: true })
assert.equal(revisionApi.getSyncRevision(), '4', 'A revision read right before a write may reset a restored server')
revisionApi.setSyncRevision('12')
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
let runtimeKind = 'web'
let userId = 1
let enqueued = 0
let failures = 0
let releaseLock = null
let lockHeld = null
class HttpRequestError extends Error {
  constructor(message, retryable) { super(message); this.retryable = retryable }
}
const fixture = {
  HttpRequestError,
  getSyncRevision: () => { if (clientRevision === null) throw new Error('unset'); return clientRevision },
  setSyncRevision: (value) => { clientRevision = value },
  clearSyncRevision: () => { clientRevision = null },
  notifySyncConflict: () => { conflicts++ },
  isSyncRevision: value => typeof value === 'string' && /^\d+$/.test(value),
  getBootstrap: async () => ({ code: 0, data: { revision: String(serverRevision) } }),
  getRuntime: () => ({ kind: runtimeKind, getServerOrigin: () => 'https://panel.test' }),
  useAuthStore: () => ({ userInfo: { id: userId } }),
  enqueueOfflineMutation: async () => { if (lockHeld) await lockHeld; enqueued++ },
  fetchChangesSince: async since => ({ hasMore: false, fromRevision: since, currentRevision: String(serverRevision), changes: changes.filter(change => Number(change.revision) > Number(since)) }),
  beginSyncActivity: () => () => {},
  clearSyncFailure: () => {},
  reportSyncFailure: () => { failures++ },
  post: async ({ url, data }) => {
    if (data.data?.offline)
      throw new HttpRequestError('offline', true)
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

// Deleting several items: a remote edit to any of them is a conflict.
serverRevision++
changes = [{ revision: String(serverRevision), resourceType: 'item', resourceId: '2', operation: 'upsert', data: { itemIconGroupId: 2 } }]
clientRevision = String(serverRevision - 1)
failures = 0
const multiDelete = await mutationPost('/panel/itemIcon/deletes', { ids: [1, 2] })
assert.equal(multiDelete.code, 1502, 'A change to any deleted id stays a conflict')
assert.equal(failures, 1, 'A failed write turns the indicator red')

// A write waiting in line is not sent after the account changes.
clientRevision = String(serverRevision)
const slow = mutationPost('/panel/itemIcon/edit', { id: 5, title: 'a' })
const switched = mutationPost('/panel/itemIcon/edit', { id: 6, title: 'b' }).then(() => null, error => error)
await new Promise(resolve => setTimeout(resolve, 1)) // the first write is now in flight
userId = 2
await slow
assert.match((await switched)?.message ?? '', /账号或服务器已切换/, 'A queued write is dropped after an account switch')
userId = 1

// Saving to the offline queue happens outside the write line, so a replay
// that holds the queue lock and writes cannot deadlock with it.
runtimeKind = 'extension'
lockHeld = new Promise((resolve) => { releaseLock = resolve })
const offline = mutationPost('/panel/itemIcon/edit', { id: 7, offline: true })
await new Promise(resolve => setTimeout(resolve, 20))
const replay = mutationPost('/panel/itemIcon/edit', { id: 8, title: 'replayed' }, { queueOnFailure: false })
assert.equal((await Promise.race([replay, new Promise(resolve => setTimeout(() => resolve({ code: 'stuck' }), 500))])).code, 0, 'A replay write is not stuck behind a write waiting for the queue lock')
releaseLock()
assert.equal((await offline).queued, true)
assert.equal(enqueued, 1)

console.log('Sync revision is monotonic per account; writes are serialized and only same-resource changes conflict.')
