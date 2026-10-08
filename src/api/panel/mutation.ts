import type { Response } from '@/utils/request'
import { HttpRequestError, post } from '@/utils/request'
import { getSyncRevision, notifySyncConflict, setSyncRevision } from '@/sync/revision'
import { isSyncRevision } from '@/sync/bootstrapSnapshot'
import { getBootstrap } from '@/api/sync'
import { getRuntime } from '@/runtime'
import { useAuthStore } from '@/store/modules/auth'
import { enqueueOfflineMutation } from '@/sync/offlineQueue'
import type { OfflineMutation, OfflineMutationAction } from '@/sync/offlineQueue'
import { fetchChangesSince } from '@/sync/changes'
import { trackSyncActivity } from '@/sync/activity'

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
function changeOverlaps(descriptor: QueueDescriptor, change: Sync.ChangeV1) {
  if (change.resourceType !== descriptor.resourceType)
    return false
  switch (descriptor.action) {
    case 'item.edit':
    case 'item.delete':
    case 'group.edit':
    case 'group.delete':
      return change.resourceId === String(descriptor.resourceId)
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
    if (!page || page.hasMore || page.changes.some(change => changeOverlaps(descriptor, change)))
      return null
    return page.currentRevision
  }
  catch {
    return null
  }
}

let mutationTail: Promise<unknown> = Promise.resolve()

/**
 * Writes from one page are sent one at a time. Two writes in flight with the
 * same expected revision would make the second one look like a change from
 * another device.
 */
export function mutationPost<T>(url: string, data: unknown, options: MutationOptions = {}): Promise<Response<T>> {
  const run = mutationTail.then(() => trackSyncActivity(() => mutationPostInternal<T>(url, data, options)))
  mutationTail = run.catch(() => undefined)
  return run
}

async function mutationPostInternal<T>(url: string, data: unknown, options: MutationOptions): Promise<Response<T>> {
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
      setSyncRevision(bootstrap.data.revision)
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
  try {
    response = await send(expectedRevision)
    if (response.code === 1502 && revisionTrusted) {
      const rebased = await rebaseRevision(url, data, expectedRevision)
      if (rebased) {
        setSyncRevision(rebased)
        response = await send(rebased)
      }
    }
  }
  catch (error) {
    if (queueOnFailure && error instanceof HttpRequestError && error.retryable && await enqueueIfSupported(options.queuePayload ?? data, url, revisionTrusted ? expectedRevision : null))
      return queuedResponse<T>(data)
    throw error
  }

  // Never replay a stale write automatically: doing so with a fresh revision
  // would silently overwrite a concurrent edit made on another device.
  if (response.code === 1502) {
    if (queueOnFailure && await enqueueIfSupported(options.queuePayload ?? data, url, revisionTrusted ? expectedRevision : null)) {
      notifySyncConflict()
      return queuedResponse<T>(data, true)
    }
    if (queueOnFailure)
      notifySyncConflict()
    return response as unknown as Response<T>
  }

  if (response.code !== 0)
    return response as unknown as Response<T>
  if (!response.data || !isSyncRevision(response.data.revision))
    throw new Error('Server returned an invalid mutation revision.')
  setSyncRevision(response.data.revision)
  return { ...response, data: response.data.result }
}
