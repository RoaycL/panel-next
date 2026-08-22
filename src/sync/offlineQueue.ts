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
  // null 表示入队时无法取得可信的服务端 revision（例如离线且快照不可用）。
  // 冲突判定会降级为「仅检测资源被删」，避免拿未知基线误报冲突。
  baseRevision: Sync.Revision | null
  payload: T
  createdAt: string
  status: 'pending' | 'replaying' | 'conflict' | 'failed' | 'applied'
  error?: string
}

export const OFFLINE_QUEUE_KEY_PREFIX = 'PANEL_NEXT_OFFLINE_QUEUE_V1.'
const offlineQueueListeners = new Set<() => void>()

export function onOfflineQueueChanged(listener: () => void) {
  offlineQueueListeners.add(listener)
  return () => offlineQueueListeners.delete(listener)
}

function notifyOfflineQueueChanged() {
  offlineQueueListeners.forEach(listener => listener())
}

export function generateIdempotencyKey(prefix = 'idemp'): string {
  const timestamp = Date.now().toString(36)
  const randomStr = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}_${randomStr}`
}

function queueStorageKey(accountId: number, origin?: string): string {
  const safeOrigin = (origin || getRuntime().getServerOrigin() || 'default').replace(/\W/g, '_')
  return `${OFFLINE_QUEUE_KEY_PREFIX}${safeOrigin}.${accountId}`
}

export function getOfflineQueueLockName(accountId: number, origin?: string) {
  const scope = origin || getRuntime().getServerOrigin() || 'default'
  return `panel-next-offline-replay:${scope}:${accountId}`
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

export function normalizeReplayableQueue(queue: OfflineMutation[]): OfflineMutation[] {
  return queue.map(mutation => mutation.status === 'replaying'
    ? { ...mutation, status: 'pending', error: '上次同步意外中断，等待重试' }
    : mutation)
}

export async function writeOfflineQueue(accountId: number, queue: OfflineMutation[], origin?: string): Promise<boolean> {
  const storage = getRuntime().storage
  const key = queueStorageKey(accountId, origin)
  const previous = storage.getItem(key)
  try {
    storage.setItem(key, JSON.stringify(queue))
    await storage.flush?.()
    notifyOfflineQueueChanged()
    return true
  }
  catch (error) {
    console.error('Failed to write offline mutation queue:', error)
    if (previous === null)
      storage.removeItem(key)
    else
      storage.setItem(key, previous)
    try {
      await storage.flush?.()
    }
    catch {
      // Keep the in-memory value aligned with the last trusted payload even
      // when the browser storage area is temporarily unavailable.
    }
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
  const persist = async () => {
    const queue = readOfflineQueue(accountId, origin)
    const fullMutation: OfflineMutation<T> = {
      ...mutation,
      idempotencyKey: mutation.idempotencyKey || generateIdempotencyKey(),
      createdAt: mutation.createdAt || new Date().toISOString(),
      status: 'pending',
    }

    // 幂等防重：若已存在相同 idempotencyKey，则更新内容
    const existingIndex = queue.findIndex(m => m.idempotencyKey === fullMutation.idempotencyKey)
    if (existingIndex >= 0)
      queue[existingIndex] = fullMutation
    else
      queue.push(fullMutation)

    if (!await writeOfflineQueue(accountId, queue, origin))
      throw new Error('离线修改无法写入浏览器存储。')
    return fullMutation
  }

  return runWithQueueLock(accountId, persist, origin)
}

/** Serialize read-modify-write cycles with replay/enqueue via Web Locks (S3). */
async function runWithQueueLock<T>(accountId: number, task: () => Promise<T>, origin?: string): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request(getOfflineQueueLockName(accountId, origin), task)
  return task()
}

export async function removeOfflineMutation(accountId: number, idempotencyKey: string, origin?: string): Promise<boolean> {
  return runWithQueueLock(accountId, async () => {
    const queue = readOfflineQueue(accountId, origin)
    const nextQueue = queue.filter(m => m.idempotencyKey !== idempotencyKey)
    if (nextQueue.length !== queue.length)
      return writeOfflineQueue(accountId, nextQueue, origin)
    return true
  }, origin)
}

export async function clearOfflineQueue(accountId: number, origin?: string): Promise<boolean> {
  return runWithQueueLock(accountId, () => writeOfflineQueue(accountId, [], origin), origin)
}

export function getPendingMutationCount(accountId: number, origin?: string): number {
  return readOfflineQueue(accountId, origin).filter(mutation => mutation.status !== 'applied').length
}
