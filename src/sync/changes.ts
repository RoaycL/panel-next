import { getChanges } from '@/api/sync'
import { isSyncRevision } from './bootstrapSnapshot'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value))
}

function isChange(value: unknown): value is Sync.ChangeV1 {
  if (!isRecord(value))
    return false
  return isSyncRevision(value.revision)
    && (value.resourceType === 'panel' || value.resourceType === 'group' || value.resourceType === 'item')
    && typeof value.resourceId === 'string'
    && value.resourceId.length > 0
    && value.resourceId.length <= 64
    && (value.operation === 'upsert' || value.operation === 'delete')
    && isTimestamp(value.changedAt)
    && 'data' in value
    && (value.operation !== 'delete' || value.data === null)
}

export function isChangesResponseV1(value: unknown): value is Sync.ChangesResponseV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.hasMore !== 'boolean' || !Array.isArray(value.changes))
    return false
  if (!isSyncRevision(value.fromRevision) || !isSyncRevision(value.nextRevision) || !isSyncRevision(value.currentRevision))
    return false
  if (value.changes.length > 500 || !value.changes.every(isChange))
    return false
  const from = BigInt(value.fromRevision)
  const next = BigInt(value.nextRevision)
  const current = BigInt(value.currentRevision)
  if (from > next || next > current)
    return false
  let previous = from
  for (const change of value.changes) {
    const revision = BigInt(change.revision)
    if (revision <= previous || revision > next)
      return false
    previous = revision
  }
  return value.changes.length === 0 ? next === from : previous === next
}

/**
 * Fetches but deliberately does not apply or persist changes. SYNC-07 will
 * advance the cursor only after all mutations are durably applied.
 */
export async function fetchChangesSince(cursor: Sync.Revision, limit = 200) {
  if (!isSyncRevision(cursor))
    return null
  const response = await getChanges(cursor, limit)
  return response.code === 0 && isChangesResponseV1(response.data) ? response.data : null
}
