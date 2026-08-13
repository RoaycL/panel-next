import { getChanges } from '@/api/sync'
import { isBootstrapGroup, isBootstrapItem, isBootstrapResponseV1, isSyncRevision } from './bootstrapSnapshot'

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

function isCanonicalResourceId(value: string) {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
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
    if (revision !== previous + 1n || revision > next || !isCanonicalResourceId(change.resourceId))
      return false
    previous = revision
  }
  if (value.changes.length === 0 ? next !== from : previous !== next)
    return false
  return value.hasMore ? next < current : next === current
}

export async function fetchChangesSince(cursor: Sync.Revision, limit = 200) {
  if (!isSyncRevision(cursor))
    return null
  const response = await getChanges(cursor, limit)
  return response.code === 0 && isChangesResponseV1(response.data) ? response.data : null
}

function cloneBootstrap(data: Sync.BootstrapResponseV1): Sync.BootstrapResponseV1 {
  return JSON.parse(JSON.stringify(data)) as Sync.BootstrapResponseV1
}

function isPanelPayload(value: unknown): value is {
  revision: Sync.Revision
  config: Panel.panelConfig
  searchEngine: Record<string, unknown>
} {
  return isRecord(value)
    && isSyncRevision(value.revision)
    && isRecord(value.config)
    && isRecord(value.searchEngine)
}

function sortPanel(data: Sync.BootstrapResponseV1) {
  const compare = (left: { sort: number, createTime: string, id: number }, right: { sort: number, createTime: string, id: number }) =>
    left.sort - right.sort || left.createTime.localeCompare(right.createTime) || left.id - right.id
  data.panel.groups.sort(compare)
  data.panel.groups.forEach(group => group.items.sort(compare))
}

function applyChange(data: Sync.BootstrapResponseV1, change: Sync.ChangeV1) {
  const resourceId = Number(change.resourceId)
  if (change.resourceType === 'panel') {
    if (change.operation !== 'upsert' || resourceId !== data.account.id || !isPanelPayload(change.data)
      || change.data.revision !== change.revision) {
      return false
    }
    data.panel = {
      ...data.panel,
      revision: change.data.revision,
      config: change.data.config,
      searchEngine: change.data.searchEngine,
    }
    return true
  }

  if (change.resourceType === 'group') {
    const index = data.panel.groups.findIndex(group => group.id === resourceId)
    if (change.operation === 'delete') {
      if (index < 0)
        return false
      data.panel.groups.splice(index, 1)
      return true
    }
    if (!isBootstrapGroup(change.data) || change.data.id !== resourceId || change.data.revision !== change.revision)
      return false
    const items = index < 0 ? [] : data.panel.groups[index].items
    const group = { ...change.data, items }
    if (index < 0)
      data.panel.groups.push(group)
    else
      data.panel.groups[index] = group
    return true
  }

  if (change.operation === 'upsert') {
    if (!isBootstrapItem(change.data) || change.data.id !== resourceId || change.data.revision !== change.revision)
      return false
    const item = change.data
    const groupIndex = data.panel.groups.findIndex(group => group.id === item.itemIconGroupId)
    if (groupIndex < 0)
      return false
    for (const group of data.panel.groups) {
      const existing = group.items.findIndex(item => item.id === resourceId)
      if (existing >= 0)
        group.items.splice(existing, 1)
    }
    data.panel.groups[groupIndex].items.push(item)
    return true
  }
  for (const group of data.panel.groups) {
    const index = group.items.findIndex(item => item.id === resourceId)
    if (index >= 0) {
      group.items.splice(index, 1)
      return true
    }
  }
  return false
}

/** Applies one validated page without mutating the trusted source snapshot. */
export function applyChangesPage(
  source: Sync.BootstrapResponseV1,
  page: Sync.ChangesResponseV1,
): Sync.BootstrapResponseV1 | null {
  if (!isBootstrapResponseV1(source) || !isChangesResponseV1(page) || page.fromRevision !== source.revision)
    return null
  const next = cloneBootstrap(source)
  for (const change of page.changes) {
    if (!applyChange(next, change))
      return null
    next.revision = change.revision
  }
  if (next.revision !== page.nextRevision)
    return null
  sortPanel(next)
  return isBootstrapResponseV1(next) ? next : null
}

export interface IncrementalSyncResult {
  data: Sync.BootstrapResponseV1
  pages: number
  changes: number
}

/** Fetches and applies every available page atomically in memory. */
export async function synchronizeBootstrap(
  source: Sync.BootstrapResponseV1,
  fetchPage: (cursor: Sync.Revision, limit: number) => Promise<Sync.ChangesResponseV1 | null> = fetchChangesSince,
  limit = 200,
): Promise<IncrementalSyncResult | null> {
  if (!isBootstrapResponseV1(source) || !Number.isInteger(limit) || limit < 1 || limit > 500)
    return null
  let data = cloneBootstrap(source)
  let pages = 0
  let changes = 0
  while (pages < 1000 && changes <= 100000) {
    const page = await fetchPage(data.revision, limit)
    if (!page)
      return null
    const applied = applyChangesPage(data, page)
    if (!applied)
      return null
    data = applied
    pages++
    changes += page.changes.length
    if (!page.hasMore)
      return { data, pages, changes }
    if (page.nextRevision === page.fromRevision)
      return null
  }
  return null
}
