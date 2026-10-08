import type { Response } from '@/utils/request'
import { HttpRequestError, post } from '@/utils/request'
import { clearSyncRevision, getSyncRevision, notifySyncConflict, setSyncRevision } from '@/sync/revision'
import { isSyncRevision } from '@/sync/bootstrapSnapshot'
import { getBootstrap } from '@/api/sync'
import { getRuntime } from '@/runtime'
import { useAuthStore } from '@/store/modules/auth'
import { enqueueOfflineMutation } from '@/sync/offlineQueue'
import type { OfflineMutation, OfflineMutationAction } from '@/sync/offlineQueue'
import { fetchChangesSince } from '@/sync/changes'
import { beginSyncActivity, clearSyncFailure, reportSyncFailure } from '@/sync/activity'

interface MutationEnvelope<T> {
  revision: Sync.Revision
  result: T
}

interface QueueDescriptor {
  action: OfflineMutationAction
  resourceType: OfflineMutation['resourceType']
  resourceId?: string | number
  payload: unknown
}

function queueDescriptor(url: string, data: any): QueueDescriptor | null {
  // id<=0 的 edit 语义上是「新增」：离线时同样入队，重放时由服务端创建并分配 ID。
  if (url === '/panel/itemIcon/edit') {
    return Number(data?.id) > 0
      ? { action: 'item.edit', resourceType: 'item', resourceId: data.id, payload: data }
      : { action: 'item.add', resourceType: 'item', payload: data }
  }
  if (url === '/panel/itemIcon/deletes')
    return { action: 'item.delete', resourceType: 'item', resourceId: data?.ids?.[0], payload: data }
  if (url === '/panel/itemIcon/saveSort')
    return { action: 'item.sort', resourceType: 'item', resourceId: data?.itemIconGroupId, payload: data }
  if (url === '/panel/itemIconGroup/edit') {
    return Number(data?.id) > 0
      ? { action: 'group.edit', resourceType: 'group', resourceId: data.id, payload: data }
      : { action: 'group.add', resourceType: 'group', payload: data }
  }
  if (url === '/panel/itemIconGroup/deletes')
    return { action: 'group.delete', resourceType: 'group', resourceId: data?.ids?.[0], payload: data }
  if (url === '/panel/itemIconGroup/saveSort')
    return { action: 'group.sort', resourceType: 'group', payload: data }
  if (url === '/panel/userConfig/set')
    return { action: 'panel.set', resourceType: 'panel', payload: data }
  return null
}

async function enqueueIfSupported(data: unknown, url: string, baseRevision: Sync.Revision | null) {
  const runtime = getRuntime()
  const accountId = useAuthStore().userInfo?.id
  const descriptor = queueDescriptor(url, data)
  if (runtime.kind !== 'extension' || !accountId || !descriptor)
    return false
  await enqueueOfflineMutation(accountId, { ...descriptor, baseRevision })
  return true
}

function canQueueMutation(data: unknown, url: string) {
  return getRuntime().kind === 'extension'
    && Boolean(useAuthStore().userInfo?.id)
    && Boolean(queueDescriptor(url, data))
}

function queuedResponse<T>(data: unknown, conflict = false): Response<T> {
  return {
    code: 0,
    msg: conflict ? '检测到云端冲突，已进入冲突处理' : '网络不可用，修改已保存到离线队列',
    data: data as T,
    queued: true,
    conflict,
  }
}

export interface MutationOptions {
  queueOnFailure?: boolean
  /** Local replay metadata; never included in the server request. */
  queuePayload?: unknown
}

/** Whether a change written by someone else touches what this write changes. */
function changeOverlaps(descriptor: QueueDescriptor, data: any, change: Sync.ChangeV1) {
  if (change.resourceType !== descriptor.resourceType)
    return false
  switch (descriptor.action) {
    case 'item.edit':
    case 'group.edit':
      return change.resourceId === String(descriptor.resourceId)
    case 'item.delete':
    case 'group.delete': {
      // A delete may cover several ids; any of them changing is a conflict.
      const ids: unknown[] = Array.isArray(data?.ids) ? data.ids : [descriptor.resourceId]
      return ids.some(id => String(id) === change.resourceId)
    }
    case 'item.sort':
      // A sort rewrites every item of one group; deletes carry no group id.
      return change.operation === 'delete'
        || (change.data as { itemIconGroupId?: unknown } | null)?.itemIconGroupId === Number(descriptor.resourceId)
    case 'item.add':
    case 'group.add':
      return false
    default:
      // panel.set and group.sort rewrite the whole resource.
      return true
  }
}

/**
 * The revision is shared by the whole account, so a 1502 also happens when
 * an unrelated resource changed (another tab, a wallpaper save, a settings
 * flush). Only a change to the same resource is a real conflict; otherwise
 * return the current revision so the write can be retried on top of it.
 */
async function rebaseRevision(url: string, data: unknown, expectedRevision: Sync.Revision): Promise<Sync.Revision | null> {
  const descriptor = queueDescriptor(url, data)
  if (!descriptor)
    return null
  try {
    const page = await fetchChangesSince(expectedRevision)
    if (!page || page.hasMore || page.changes.some(change => changeOverlaps(descriptor, data, change)))
      return null
    return page.currentRevision
  }
  catch {
    return null
  }
}

function mutationScope() {
  return `${getRuntime().getServerOrigin() ?? ''}:${useAuthStore().userInfo?.id ?? ''}`
}

type SendOutcome<T> =
  | { kind: 'done', response: Response<T> }
  | { kind: 'queue', baseRevision: Sync.Revision | null, conflict: boolean, response?: Response<T>, error?: unknown }

let sendTail: Promise<unknown> = Promise.resolve()
let durableTail: Promise<unknown> = Promise.resolve()

/**
 * Writes from one page are sent one at a time. Two writes in flight with the
 * same expected revision would make the second one look like a change from
 * another device.
 *
 * A user write also holds its place until a failed request is saved to the
 * offline queue, so an older intent can never be queued after a newer write.
 * Writes that never queue (offline replay, the settings flush) only wait for
 * the request line: replay holds the queue lock, and waiting for another
 * write's queue save would deadlock with it.
 */
export async function mutationPost<T>(url: string, data: unknown, options: MutationOptions = {}): Promise<Response<T>> {
  const endActivity = beginSyncActivity()
  const scope = mutationScope()
  const run = async () => {
    const step = sendTail.then(() => sendMutation<T>(url, data, options, scope))
    sendTail = step.catch(() => undefined)
    const outcome = await step
    return outcome.kind === 'done' ? outcome.response : await settleQueuedMutation<T>(url, data, options, outcome)
  }
  try {
    let response: Response<T>
    if (options.queueOnFailure !== false) {
      const durable = durableTail.then(run)
      durableTail = durable.catch(() => undefined)
      response = await durable
    }
    else {
      response = await run()
    }
    if (response.code === 0)
      clearSyncFailure()
    else
      reportSyncFailure(response.msg || '同步失败')
    return response
  }
  catch (error) {
    reportSyncFailure(error instanceof Error ? error.message : '同步失败')
    throw error
  }
  finally {
    endActivity()
  }
}

async function settleQueuedMutation<T>(url: string, data: unknown, options: MutationOptions, outcome: Extract<SendOutcome<T>, { kind: 'queue' }>): Promise<Response<T>> {
  const queued = await enqueueIfSupported(options.queuePayload ?? data, url, outcome.baseRevision)
  if (outcome.conflict) {
    notifySyncConflict()
    return queued ? queuedResponse<T>(data, true) : outcome.response!
  }
  if (!queued)
    throw outcome.error
  return queuedResponse<T>(data)
}

async function sendMutation<T>(url: string, data: unknown, options: MutationOptions, scope: string): Promise<SendOutcome<T>> {
  // A write captured for one account must never be sent with another
  // account's token after a logout or server switch.
  if (mutationScope() !== scope)
    throw new HttpRequestError('账号或服务器已切换，修改未提交', false)
  const queueOnFailure = options.queueOnFailure !== false
  const queueSupported = queueOnFailure && canQueueMutation(data, url)
  let expectedRevision: Sync.Revision
  // 基线不可信时（bootstrap 也拉不到）以 null 入队，冲突判定降级，避免误报。
  let revisionTrusted = true
  try {
    expectedRevision = getSyncRevision()
  }
  catch {
    const bootstrap = await getBootstrap()
    if (bootstrap.code === 0 && bootstrap.data) {
      setSyncRevision(bootstrap.data.revision, { authoritative: true })
      expectedRevision = bootstrap.data.revision
    }
    else {
      expectedRevision = '0'
      revisionTrusted = false
    }
  }

  const send = (revision: Sync.Revision) => post<MutationEnvelope<T>>({
    url,
    silentNetworkError: queueSupported,
    data: {
      expectedRevision: revision,
      data,
    },
  })

  let response: Response<MutationEnvelope<T>>
  // The revision the last request was based on; a rebased one has already
  // been checked against the changes in between.
  let sentRevision = expectedRevision
  try {
    response = await send(sentRevision)
    if (response.code === 1502 && revisionTrusted) {
      const rebased = await rebaseRevision(url, data, sentRevision)
      if (rebased) {
        setSyncRevision(rebased, { authoritative: true })
        sentRevision = rebased
        response = await send(rebased)
      }
    }
  }
  catch (error) {
    if (queueSupported && error instanceof HttpRequestError && error.retryable)
      return { kind: 'queue', baseRevision: revisionTrusted ? sentRevision : null, conflict: false, error }
    throw error
  }

  // Never replay a stale write automatically: doing so with a fresh revision
  // would silently overwrite a concurrent edit made on another device.
  if (response.code === 1502) {
    // The cursor may be stale or from a reset server: read it again next time.
    clearSyncRevision()
    if (queueOnFailure)
      return { kind: 'queue', baseRevision: revisionTrusted ? sentRevision : null, conflict: true, response: response as unknown as Response<T> }
    return { kind: 'done', response: response as unknown as Response<T> }
  }

  if (response.code !== 0)
    return { kind: 'done', response: response as unknown as Response<T> }
  if (!response.data || !isSyncRevision(response.data.revision))
    throw new Error('Server returned an invalid mutation revision.')
  setSyncRevision(response.data.revision)
  return { kind: 'done', response: { ...response, data: response.data.result } }
}
