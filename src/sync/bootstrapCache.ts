import { getBootstrap } from '@/api/sync'
import { getRuntime } from '@/runtime'
import { parseBootstrapSnapshot, serializeBootstrapSnapshot } from './bootstrapSnapshot'
import { retryNetworkOperation } from './retry'

const BOOTSTRAP_SNAPSHOT_KEY_PREFIX = 'PANEL_NEXT_BOOTSTRAP_SNAPSHOT_V1.'

function cacheKey(accountId: number) {
  return `${BOOTSTRAP_SNAPSHOT_KEY_PREFIX}${accountId}`
}

export function readBootstrapSnapshot(accountId: number) {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return null
  const origin = runtime.getServerOrigin()
  if (!origin)
    return null
  const key = cacheKey(accountId)
  const snapshot = parseBootstrapSnapshot(runtime.storage.getItem(key), origin, accountId)
  if (!snapshot)
    runtime.storage.removeItem(key)
  return snapshot
}

/** The trusted snapshot revision is the last durably applied client cursor. */
export function readBootstrapRevisionCursor(accountId: number): Sync.Revision | null {
  return readBootstrapSnapshot(accountId)?.data.revision ?? null
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

  const result = await retryNetworkOperation(() => getBootstrap())
  if (!result.ok || !result.value || result.value.code !== 0)
    return { data: null, savedAt: null, attempts: result.attempts }

  const savedAt = new Date().toISOString()
  const serialized = serializeBootstrapSnapshot(result.value.data, origin, accountId, savedAt)
  if (!serialized)
    return { data: null, savedAt: null, attempts: result.attempts }
  runtime.storage.setItem(cacheKey(accountId), serialized)
  await runtime.storage.flush?.()
  return { data: result.value.data, savedAt, attempts: result.attempts }
}
