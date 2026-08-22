import { getBootstrap } from '@/api/sync'
import { getRuntime } from '@/runtime'
import { parseBootstrapSnapshot, serializeBootstrapSnapshot } from './bootstrapSnapshot'
import { synchronizeBootstrap } from './changes'
import { retryNetworkOperation } from './retry'

export const BOOTSTRAP_SNAPSHOT_KEY_PREFIX = 'PANEL_NEXT_BOOTSTRAP_SNAPSHOT_V1.'

function cacheKey(accountId: number) {
  return `${BOOTSTRAP_SNAPSHOT_KEY_PREFIX}${accountId}`
}

async function persistSnapshot(key: string, serialized: string) {
  const storage = getRuntime().storage
  const previous = storage.getItem(key)
  storage.setItem(key, serialized)
  try {
    await storage.flush?.()
    // Only the active account needs a bootstrap snapshot. Old account
    // snapshots can otherwise consume the extension's shared local quota.
    const staleKeys = storage.keys?.().filter(candidate =>
      candidate.startsWith(BOOTSTRAP_SNAPSHOT_KEY_PREFIX) && candidate !== key,
    ) ?? []
    staleKeys.forEach(candidate => storage.removeItem(candidate))
    if (staleKeys.length) {
      try {
        await storage.flush?.()
      }
      catch (error) {
        console.warn('Failed to prune stale bootstrap snapshots.', error)
      }
    }
    return true
  }
  catch {
    if (previous === null)
      storage.removeItem(key)
    else
      storage.setItem(key, previous)
    try {
      await storage.flush?.()
    }
    catch {
      // The in-memory adapter has still been restored to the trusted value.
    }
    return false
  }
}

export function readBootstrapSnapshot(accountId: number) {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return null
  const origin = runtime.getServerOrigin()
  if (!origin)
    return null
  const key = cacheKey(accountId)
  const raw = runtime.storage.getItem(key)
  const snapshot = parseBootstrapSnapshot(raw, origin, accountId)
  if (!snapshot)
    runtime.storage.removeItem(key)
  else if (snapshot.cacheVersion === 2) {
    const upgraded = serializeBootstrapSnapshot(snapshot.data, origin, accountId, snapshot.savedAt)
    if (upgraded && upgraded !== raw) {
      runtime.storage.setItem(key, upgraded)
      void runtime.storage.flush?.().catch(error => console.error('Failed to persist upgraded bootstrap snapshot.', error))
    }
  }
  return snapshot
}

/** The trusted snapshot revision is the last durably applied client cursor. */
export function readBootstrapRevisionCursor(accountId: number): Sync.Revision | null {
  return readBootstrapSnapshot(accountId)?.cursorRevision ?? null
}

export interface BootstrapRefreshResult {
  data: Sync.BootstrapResponseV1 | null
  savedAt: string | null
  attempts: number
}

export async function refreshBootstrapSnapshot(accountId: number): Promise<BootstrapRefreshResult> {
  const runtime = getRuntime()
  const origin = runtime.getServerOrigin()
  if (runtime.kind !== 'extension' || !origin)
    return { data: null, savedAt: null, attempts: 0 }

  const cached = readBootstrapSnapshot(accountId)
  const result = await retryNetworkOperation(async () => {
    if (cached) {
      const incremental = await synchronizeBootstrap(cached.data)
      if (incremental)
        return incremental.data
    }
    const bootstrap = await getBootstrap()
    return bootstrap.code === 0 ? bootstrap.data : null
  })
  if (!result.ok || !result.value)
    return { data: null, savedAt: null, attempts: result.attempts }

  const savedAt = new Date().toISOString()
  const serialized = serializeBootstrapSnapshot(result.value, origin, accountId, savedAt)
  if (!serialized)
    return { data: null, savedAt: null, attempts: result.attempts }
  if (!await persistSnapshot(cacheKey(accountId), serialized))
    return { data: null, savedAt: null, attempts: result.attempts }
  return { data: result.value, savedAt, attempts: result.attempts }
}
