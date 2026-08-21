import { getBootstrap } from '@/api/sync'
import { edit as editItem, deletes as deleteItems, saveSort as saveItemSort } from '@/api/panel/itemIcon'
import { edit as editGroup, deletes as deleteGroups, saveSort as saveGroupSort } from '@/api/panel/itemIconGroup'
import { set as setUserConfig } from '@/api/panel/userConfig'
import { setSyncRevision } from './revision'
import {
  type OfflineMutation,
  readOfflineQueue,
  removeOfflineMutation,
  writeOfflineQueue,
} from './offlineQueue'
import {
  type ConflictDescriptor,
  type ConflictResolutionChoice,
  evaluateConflict,
} from './conflictResolver'

export interface ReplayQueueResult {
  total: number
  succeeded: number
  failed: number
  conflicts: ConflictDescriptor[]
  interrupted: boolean
  error?: string
}

export type ConflictHandler = (conflict: ConflictDescriptor) => Promise<ConflictResolutionChoice>

/**
 * OFFLINE-01 & OFFLINE-04: 执行离线 Mutation 队列重放
 */
export async function replayOfflineQueue(
  accountId: number,
  onConflict?: ConflictHandler,
  origin?: string,
): Promise<ReplayQueueResult> {
  const queue = readOfflineQueue(accountId, origin)
  if (queue.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, conflicts: [], interrupted: false }
  }

  // 1. 获取云端最新状态
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

  let currentRemoteBootstrap: Sync.BootstrapResponseV1 = bootstrapRes.data
  setSyncRevision(currentRemoteBootstrap.revision)

  const result: ReplayQueueResult = {
    total: queue.length,
    succeeded: 0,
    failed: 0,
    conflicts: [],
    interrupted: false,
  }

  // 复制一份队列按顺序执行
  const pendingMutations = [...queue]

  for (const mutation of pendingMutations) {
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
            await removeOfflineMutation(accountId, mutation.idempotencyKey, origin)
            result.succeeded++
            continue
          }
          else if (choice === 'duplicate_local') {
            // 另存为副本（针对 card）
            if (mutation.action === 'item.edit') {
              const payload = { ...(mutation.payload as Panel.ItemInfo) }
              delete (payload as any).id
              delete (payload as any).revision
              payload.title = `${payload.title || '快捷书签'} (离线副本)`
              mutation.action = 'item.add'
              mutation.payload = payload
            }
          }
          // keep_local 或 duplicate_local 继续向下执行发送
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
    try {
      const success = await executeMutationAction(mutation)
      if (success) {
        mutation.status = 'applied'
        result.succeeded++
        await removeOfflineMutation(accountId, mutation.idempotencyKey, origin)

        // 刷新最新的服务端数据基线
        const nextBootstrap = await getBootstrap()
        if (nextBootstrap.code === 0 && nextBootstrap.data) {
          currentRemoteBootstrap = nextBootstrap.data
          setSyncRevision(currentRemoteBootstrap.revision)
        }
      }
      else {
        mutation.status = 'failed'
        result.failed++
        result.interrupted = true
        break
      }
    }
    catch (err) {
      mutation.status = 'failed'
      mutation.error = err instanceof Error ? err.message : '重放网络或服务端错误'
      result.failed++
      result.interrupted = true
      break
    }
  }

  // 更新队列状态到存储
  await writeOfflineQueue(accountId, readOfflineQueue(accountId, origin), origin)
  return result
}

/**
 * 具体 action 派发执行
 */
async function executeMutationAction(mutation: OfflineMutation): Promise<boolean> {
  const payload = mutation.payload

  switch (mutation.action) {
    case 'item.add':
    case 'item.edit': {
      const itemPayload = { ...(payload as Panel.ItemInfo) }
      delete (itemPayload as any).revision
      const res = await editItem(itemPayload)
      return res.code === 0
    }

    case 'item.delete': {
      const ids = (payload as any)?.ids || [mutation.resourceId]
      const res = await deleteItems(ids)
      return res.code === 0
    }

    case 'item.sort': {
      const res = await saveItemSort(payload as Panel.ItemIconSortRequest)
      return res.code === 0
    }

    case 'group.add':
    case 'group.edit': {
      const groupPayload = { ...(payload as Panel.ItemIconGroup) }
      delete (groupPayload as any).revision
      const res = await editGroup(groupPayload)
      return res.code === 0
    }

    case 'group.delete': {
      const ids = (payload as any)?.ids || [mutation.resourceId]
      const res = await deleteGroups(ids)
      return res.code === 0
    }

    case 'group.sort': {
      const res = await saveGroupSort((payload as any)?.sortItems || payload)
      return res.code === 0
    }

    case 'panel.set': {
      const res = await setUserConfig(payload)
      return res.code === 0
    }

    default:
      return false
  }
}
