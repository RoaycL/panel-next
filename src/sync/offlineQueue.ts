import { getRuntime } from '@/runtime'

export type OfflineMutationAction =
  | 'item.add'
  | 'item.edit'
  | 'item.delete'
  | 'item.sort'
  | 'group.add'
  | 'group.edit'
  | 'group.delete'
  | 'group.sort'
  | 'panel.set'

export interface OfflineMutation<T = any> {
  idempotencyKey: string
  action: OfflineMutationAction
  resourceType: 'item' | 'group' | 'panel'
  resourceId?: string | number
  baseRevision: Sync.Revision
  payload: T
  createdAt: string
  status: 'pending' | 'replaying' | 'conflict' | 'failed' | 'applied'
  error?: string
}

const OFFLINE_QUEUE_KEY_PREFIX = 'PANEL_NEXT_OFFLINE_QUEUE_V1.'

export function generateIdempotencyKey(prefix = 'idemp'): string {
  const timestamp = Date.now().toString(36)
  const randomStr = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}_${randomStr}`
}

function queueStorageKey(accountId: number, origin?: string): string {
  const safeOrigin = (origin || getRuntime().getServerOrigin() || 'default').replace(/[^a-zA-Z0-9_]/g, '_')
  return `${OFFLINE_QUEUE_KEY_PREFIX}${safeOrigin}.${accountId}`
}

export function readOfflineQueue(accountId: number, origin?: string): OfflineMutation[] {
  const storage = getRuntime().storage
  const key = queueStorageKey(accountId, origin)
  const raw = storage.getItem(key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter(item => Boolean(item && typeof item === 'object' && item.idempotencyKey && item.action))
    }
    return []
  }
  catch {
    return []
  }
}

export async function writeOfflineQueue(accountId: number, queue: OfflineMutation[], origin?: string): Promise<boolean> {
  const storage = getRuntime().storage
  const key = queueStorageKey(accountId, origin)
  try {
    storage.setItem(key, JSON.stringify(queue))
    await storage.flush?.()
    return true
  }
  catch (error) {
    console.error('Failed to write offline mutation queue:', error)
    return false
  }
}

export async function enqueueOfflineMutation<T = any>(
  accountId: number,
  mutation: Omit<OfflineMutation<T>, 'idempotencyKey' | 'createdAt' | 'status'> & {
    idempotencyKey?: string
    createdAt?: string
  },
  origin?: string,
): Promise<OfflineMutation<T>> {
  const queue = readOfflineQueue(accountId, origin)
  const fullMutation: OfflineMutation<T> = {
    ...mutation,
    idempotencyKey: mutation.idempotencyKey || generateIdempotencyKey(),
    createdAt: mutation.createdAt || new Date().toISOString(),
    status: 'pending',
  }

  // 幂等防重：若已存在相同 idempotencyKey，则更新内容
  const existingIndex = queue.findIndex(m => m.idempotencyKey === fullMutation.idempotencyKey)
  if (existingIndex >= 0) {
    queue[existingIndex] = fullMutation
  }
  else {
    queue.push(fullMutation)
  }

  await writeOfflineQueue(accountId, queue, origin)
  return fullMutation
}

export async function removeOfflineMutation(accountId: number, idempotencyKey: string, origin?: string): Promise<boolean> {
  const queue = readOfflineQueue(accountId, origin)
  const nextQueue = queue.filter(m => m.idempotencyKey !== idempotencyKey)
  if (nextQueue.length !== queue.length) {
    return writeOfflineQueue(accountId, nextQueue, origin)
  }
  return true
}

export async function clearOfflineQueue(accountId: number, origin?: string): Promise<boolean> {
  return writeOfflineQueue(accountId, [], origin)
}

export function getPendingMutationCount(accountId: number, origin?: string): number {
  return readOfflineQueue(accountId, origin).filter(m => m.status === 'pending' || m.status === 'conflict').length
}
