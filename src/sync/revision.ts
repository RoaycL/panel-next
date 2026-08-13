import { isSyncRevision } from './bootstrapSnapshot'

let currentRevision: Sync.Revision | null = null
const conflictListeners = new Set<() => void | Promise<void>>()

export function setSyncRevision(revision: Sync.Revision) {
  if (!isSyncRevision(revision))
    throw new Error('Invalid sync revision.')
  currentRevision = revision
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
