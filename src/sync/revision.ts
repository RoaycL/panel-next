import { isSyncRevision } from './bootstrapSnapshot'
import { getRuntime } from '@/runtime'
import { useAuthStore } from '@/store/modules/auth'

let currentRevision: Sync.Revision | null = null
let currentScope = ''
const conflictListeners = new Set<() => void | Promise<void>>()

function revisionScope() {
  try {
    return `${getRuntime().getServerOrigin() ?? ''}:${useAuthStore().userInfo?.id ?? ''}`
  }
  catch {
    return ''
  }
}

/**
 * The revision only moves forward within one server/account. A bootstrap or
 * cached snapshot that started before a local write must not roll the cursor
 * back: the next write would then be rejected as if another device had
 * changed the dashboard. `authoritative` is for a revision read from the
 * server right before a write, which also covers a restored server whose
 * revision went down.
 */
export function setSyncRevision(revision: Sync.Revision, options: { authoritative?: boolean } = {}) {
  if (!isSyncRevision(revision))
    throw new Error('Invalid sync revision.')
  const scope = revisionScope()
  if (!options.authoritative && currentRevision !== null && scope === currentScope && BigInt(revision) < BigInt(currentRevision))
    return
  currentRevision = revision
  currentScope = scope
}

export function getSyncRevision(): Sync.Revision {
  if (currentRevision === null)
    throw new Error('Dashboard revision is not initialized. Refresh the dashboard before editing.')
  return currentRevision
}

export function clearSyncRevision() {
  currentRevision = null
}

export function onSyncConflict(listener: () => void | Promise<void>) {
  conflictListeners.add(listener)
  return () => conflictListeners.delete(listener)
}

export function notifySyncConflict() {
  clearSyncRevision()
  for (const listener of conflictListeners)
    void listener()
}
