import { getBootstrap } from '@/api/sync'
import { edit as editItem, deletes as deleteItems, saveSort as saveItemSort } from '@/api/panel/itemIcon'
import { edit as editGroup, deletes as deleteGroups, saveSort as saveGroupSort } from '@/api/panel/itemIconGroup'
import { set as setUserConfig } from '@/api/panel/userConfig'
import { HttpRequestError } from '@/utils/request'
import { getSyncRevision, setSyncRevision } from './revision'
import {
  normalizeReplayableQueue,
  getOfflineQueueLockName,
  readOfflineQueue,
  removeOfflineMutation,
  writeOfflineQueue,
} from './offlineQueue'
import {
  evaluateConflict,
} from './conflictResolver'
import type { OfflineMutation } from './offlineQueue'
import type { ConflictDescriptor, ConflictResolutionChoice } from './conflictResolver'

export interface ReplayQueueResult {
  total: number
  succeeded: number
  failed: number
  conflicts: ConflictDescriptor[]
  interrupted: boolean
  error?: string
}

export type ConflictHandler = (conflict: ConflictDescriptor) => Promise<ConflictResolutionChoice>

interface MutationOutcome {
  ok: boolean
  /** true 表示网络层失败（可重试），应暂停整个重放；false 表示服务端明确拒绝，跳过继续。 */
  retryableNetworkFailure?: boolean
  statusCode?: number
  message?: string
}

/**
 * OFFLINE-01 & OFFLINE-04: 执行离线 Mutation 队列重放
 *
 * 失败语义（S2 修复：不再队头阻塞）：
 * - 服务端明确拒绝（校验失败/资源不存在/1502 等）：标记该条 failed/conflict 后继续后续条目；
 * - 网络层传输失败：视为「暂时不可同步」，该条回到 pending 并暂停本轮重放，等待下次在线触发。
 */
async function replayOfflineQueueInternal(
  accountId: number,
  onConflict?: ConflictHandler,
  origin?: string,
): Promise<ReplayQueueResult> {
  const queue = normalizeReplayableQueue(readOfflineQueue(accountId, origin))
  if (queue.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, conflicts: [], interrupted: false }
  }

  // 1. 获取云端最新状态
  let currentRemoteBootstrap: Sync.BootstrapResponseV1
  try {
    const bootstrapRes = await getBootstrap()
    if (bootstrapRes.code !== 0 || !bootstrapRes.data) {
      return {
        total: queue.length,
        succeeded: 0,
        failed: 0,
        conflicts: [],
        interrupted: true,
        error: bootstrapRes.msg || '无法连接到服务端获取最新基线',
      }
    }
    currentRemoteBootstrap = bootstrapRes.data
  }
  catch (error) {
    return {
      total: queue.length,
      succeeded: 0,
      failed: 0,
      conflicts: [],
      interrupted: true,
      error: error instanceof Error ? error.message : '无法连接到服务端获取最新基线',
    }
  }
  setSyncRevision(currentRemoteBootstrap.revision)

  const result: ReplayQueueResult = {
    total: queue.length,
    succeeded: 0,
    failed: 0,
    conflicts: [],
    interrupted: false,
  }

  // 复制一份队列按顺序执行（共享对象引用，最终统一持久化状态）
  const pendingMutations = [...queue]

  for (let index = 0; index < pendingMutations.length; index++) {
    const mutation = pendingMutations[index]
    const hasRemainingMutations = index < pendingMutations.length - 1

    // 2. 检测冲突语义
    const conflict = evaluateConflict(mutation, currentRemoteBootstrap)
    if (conflict) {
      result.conflicts.push(conflict)
      mutation.status = 'conflict'
      mutation.error = conflict.reason

      if (onConflict) {
        try {
          const choice = await onConflict(conflict)
          if (choice === 'keep_remote') {
            // 放弃本地离线修改，从队列中删除
            if (!await removeOfflineMutation(accountId, mutation.idempotencyKey, origin)) {
              result.interrupted = true
              result.error = '已选择云端版本，但无法更新本地离线队列'
              break
            }
            result.succeeded++
            continue
          }
          else if (choice === 'duplicate_local') {
            // 另存为副本：卡片与分组都转为「新增」语义重放
            if (mutation.action === 'item.edit') {
              const payload = { ...(mutation.payload as Panel.ItemInfo) }
              delete (payload as any).id
              delete (payload as any).revision
              payload.title = `${payload.title || '快捷书签'} (离线副本)`
              mutation.action = 'item.add'
              mutation.payload = payload
            }
            else if (mutation.action === 'group.edit') {
              const payload = { ...(mutation.payload as Panel.ItemIconGroup) }
              delete (payload as any).id
              delete (payload as any).revision
              payload.title = `${payload.title || '分组'} (离线副本)`
              mutation.action = 'group.add'
              mutation.payload = payload
            }
          }
          // keep_local 或 duplicate_local 继续向下执行发送
          mutation.status = 'pending'
        }
        catch (err) {
          result.interrupted = true
          result.error = err instanceof Error ? err.message : '用户取消冲突解决'
          break
        }
      }
      else {
        // 无冲突处理回调，暂停后续重放，等待用户接入
        result.interrupted = true
        break
      }
    }

    // 3. 执行重放请求
    mutation.status = 'replaying'
    let outcome: MutationOutcome
    try {
      outcome = await executeMutationAction(mutation)
    }
    catch (err) {
      if (err instanceof HttpRequestError && !err.retryable) {
        mutation.status = 'failed'
        mutation.error = err.message
        result.failed++
        continue
      }
      // 网络层失败：回退为 pending，等待下次在线事件重放
      mutation.status = 'pending'
      mutation.error = err instanceof Error ? err.message : '重放网络或服务端错误'
      result.interrupted = true
      result.error = mutation.error
      break
    }

    if (!outcome.ok) {
      if (outcome.statusCode === 1502) {
        // 重放窗口内云端又被并发修改：留待下轮冲突裁决，不阻塞其他条目
        mutation.status = 'conflict'
        mutation.error = outcome.message || '云端已更新，需要重新裁决'
        result.conflicts.push(buildInFlightConflictDescriptor(mutation))
        continue
      }
      mutation.status = 'failed'
      mutation.error = outcome.message || '服务端未接受该离线修改'
      result.failed++
      continue
    }

    mutation.status = 'applied'
    result.succeeded++
    if (!await removeOfflineMutation(accountId, mutation.idempotencyKey, origin)) {
      // 最终持久化阶段会剔除 applied 项，这里仅提示存储异常
      result.interrupted = true
      result.error = '云端已接受修改，但无法立即更新本地离线队列，请勿清除浏览器数据'
      break
    }

    // 4. 刷新云端基线供后续条目做冲突判定（最后一条之后无需再拉取）
    if (hasRemainingMutations) {
      try {
        const nextBootstrap = await getBootstrap()
        if (nextBootstrap.code === 0 && nextBootstrap.data) {
          currentRemoteBootstrap = nextBootstrap.data
          setSyncRevision(currentRemoteBootstrap.revision)
        }
        else {
          result.interrupted = true
          result.error = nextBootstrap.msg || '修改已提交，但无法刷新云端基线'
          break
        }
      }
      catch (error) {
        result.interrupted = true
        result.error = error instanceof Error ? error.message : '修改已提交，但无法刷新云端基线'
        break
      }
    }
  }

  // Persist the in-memory statuses. Re-reading here would discard conflict,
  // failure and interrupted-replay state transitions made above.
  const updates = new Map(queue.map(item => [item.idempotencyKey, item]))
  const remainingQueue = readOfflineQueue(accountId, origin).flatMap((persisted) => {
    const updated = updates.get(persisted.idempotencyKey)
    if (!updated)
      return [persisted] // Preserve mutations enqueued while replay was running.
    return updated.status === 'applied' ? [] : [updated]
  })
  await writeOfflineQueue(accountId, remainingQueue, origin)
  return result
}

function buildInFlightConflictDescriptor(mutation: OfflineMutation): ConflictDescriptor {
  const resourceLabel = mutation.resourceType === 'item'
    ? (mutation.payload as Panel.ItemInfo)?.title || '快捷书签'
    : mutation.resourceType === 'group'
      ? (mutation.payload as Panel.ItemIconGroup)?.title || '分组'
      : '系统面板样式与组件布局'
  return {
    idempotencyKey: mutation.idempotencyKey,
    action: mutation.action,
    resourceType: mutation.resourceType,
    resourceId: mutation.resourceId,
    resourceName: resourceLabel,
    localVersion: {
      timestamp: mutation.createdAt,
      baseRevision: mutation.baseRevision,
      data: mutation.payload,
    },
    remoteVersion: {
      revision: getSyncRevisionSafe(),
      data: null,
    },
    diffFields: [],
    reason: '重放期间云端再次发生变化，需要重新裁决',
  }
}

function getSyncRevisionSafe(): Sync.Revision {
  try {
    return getSyncRevision()
  }
  catch {
    return '0'
  }
}

/** Serialize replays across extension tabs so the same queued write cannot run twice. */
export async function replayOfflineQueue(
  accountId: number,
  onConflict?: ConflictHandler,
  origin?: string,
): Promise<ReplayQueueResult> {
  const run = () => replayOfflineQueueInternal(accountId, onConflict, origin)
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(getOfflineQueueLockName(accountId, origin), run)
  }
  return run()
}

/**
 * 具体 action 派发执行。
 *
 * 请求层约定：
 * - 网络层失败 → 抛出 HttpRequestError（retryable 标记是否值得暂停重放）；
 * - 业务失败（code!==0）→ 可能以普通响应对象 reject，或正常 resolve；
 *   统一收敛为 MutationOutcome 交由上层决定「跳过继续」还是「暂停」。
 */
async function executeMutationAction(mutation: OfflineMutation): Promise<MutationOutcome> {
  const send = async (): Promise<MutationOutcome> => {
    const payload = mutation.payload

    switch (mutation.action) {
      case 'item.add':
      case 'item.edit': {
        const itemPayload = { ...(payload as Panel.ItemInfo) }
        delete (itemPayload as any).revision
        const res = await editItem(itemPayload, false)
        return toOutcome(res)
      }

      case 'item.delete': {
        const ids = (payload as any)?.ids || [mutation.resourceId]
        const res = await deleteItems(ids, false)
        return toOutcome(res)
      }

      case 'item.sort': {
        const res = await saveItemSort(payload as Panel.ItemIconSortRequest, false)
        return toOutcome(res)
      }

      case 'group.add':
      case 'group.edit': {
        const groupPayload = { ...(payload as Panel.ItemIconGroup) }
        delete (groupPayload as any).revision
        const res = await editGroup(groupPayload, false)
        return toOutcome(res)
      }

      case 'group.delete': {
        const ids = (payload as any)?.ids || [mutation.resourceId]
        const res = await deleteGroups(ids, false)
        return toOutcome(res)
      }

      case 'group.sort': {
        const res = await saveGroupSort((payload as any)?.sortItems || payload, false)
        return toOutcome(res)
      }

      case 'panel.set': {
        const res = await setUserConfig(payload as Panel.userConfig, false)
        return toOutcome(res)
      }

      default:
        return { ok: false, message: `未支持的离线操作类型: ${mutation.action}` }
    }
  }

  try {
    return await send()
  }
  catch (err) {
    // 业务错误会以普通响应对象 reject（见 utils/request 的 apiRespErrMsg 分支）
    const code = (err as any)?.code
    if (typeof code === 'number')
      return { ok: false, statusCode: code, message: (err as any)?.msg }
    throw err
  }
}

function toOutcome(res: { code: number, msg?: string }): MutationOutcome {
  return res.code === 0
    ? { ok: true }
    : { ok: false, statusCode: res.code, message: res.msg }
}
