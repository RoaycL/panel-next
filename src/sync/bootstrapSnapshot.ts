export const BOOTSTRAP_SNAPSHOT_CACHE_VERSION = 2
export const BOOTSTRAP_SCHEMA_VERSION = 1
export const MAX_BOOTSTRAP_SNAPSHOT_BYTES = 5 * 1024 * 1024

export interface BootstrapSnapshotEnvelope {
  cacheVersion: 2
  serverOrigin: string
  accountId: number
  savedAt: string
  cursorRevision: Sync.Revision
  data: Sync.BootstrapResponseV1
}

interface LegacyBootstrapSnapshotEnvelope {
  cacheVersion: 1
  serverOrigin: string
  accountId: number
  savedAt: string
  data: Sync.BootstrapResponseV1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value)
}

function isBoundedString(value: unknown, maximum = 4096): value is string {
  return typeof value === 'string' && value.length <= maximum
}

export function isSyncRevision(value: unknown): value is Sync.Revision {
  return typeof value === 'string'
    && /^(?:0|[1-9]\d{0,18})$/.test(value)
    && BigInt(value) <= 9223372036854775807n
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value))
}

function isServerOrigin(value: unknown): value is string {
  if (typeof value !== 'string')
    return false
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !parsed.username
      && !parsed.password
      && parsed.origin === value
  }
  catch {
    return false
  }
}

function utf8Size(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function isIcon(value: unknown): value is Panel.ItemIcon {
  if (!isRecord(value) || !isInteger(value.itemType))
    return false
  return (value.src === undefined || isBoundedString(value.src))
    && (value.text === undefined || isBoundedString(value.text))
    && (value.backgroundColor === undefined || isBoundedString(value.backgroundColor, 128))
}

export function isBootstrapItem(value: unknown): value is Sync.BootstrapItem {
  if (!isRecord(value))
    return false
  return isSafeId(value.id)
    && isTimestamp(value.createTime)
    && isTimestamp(value.updateTime)
    && isIcon(value.icon)
    && isBoundedString(value.title, 200)
    && isBoundedString(value.url, 4096)
    && isBoundedString(value.lanUrl, 4096)
    && isBoundedString(value.description, 8192)
    && isInteger(value.openMethod)
    && isInteger(value.sort)
    && isSyncRevision(value.revision)
    && isSafeId(value.itemIconGroupId)
}

export function isBootstrapGroup(value: unknown): value is Sync.BootstrapGroup {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 100000)
    return false
  return isSafeId(value.id)
    && isTimestamp(value.createTime)
    && isTimestamp(value.updateTime)
    && isBoundedString(value.icon, 4096)
    && isBoundedString(value.title, 200)
    && isBoundedString(value.description, 8192)
    && isInteger(value.sort)
    && isSyncRevision(value.revision)
    && value.items.every(isBootstrapItem)
}

function isBootstrapAccount(value: unknown): value is Sync.BootstrapAccount {
  if (!isRecord(value))
    return false
  return isSafeId(value.id)
    && isBoundedString(value.username, 320)
    && isBoundedString(value.name, 200)
    && isBoundedString(value.headImage, 4096)
    && isInteger(value.role)
    && isBoundedString(value.mail, 320)
    && isInteger(value.status)
}

export function isBootstrapResponseV1(value: unknown): value is Sync.BootstrapResponseV1 {
  if (!isRecord(value) || value.schemaVersion !== BOOTSTRAP_SCHEMA_VERSION)
    return false
  if (!isSyncRevision(value.revision) || !isTimestamp(value.generatedAt) || !isBootstrapAccount(value.account))
    return false
  if (!isRecord(value.panel) || !isSyncRevision(value.panel.revision))
    return false
  if (!isRecord(value.panel.config) || !isRecord(value.panel.searchEngine))
    return false
  if (!Array.isArray(value.panel.groups) || value.panel.groups.length > 10000)
    return false
  let itemCount = 0
  const groupIds = new Set<number>()
  const itemIds = new Set<number>()
  for (const group of value.panel.groups) {
    if (!isBootstrapGroup(group))
      return false
    if (groupIds.has(group.id))
      return false
    groupIds.add(group.id)
    for (const item of group.items) {
      if (item.itemIconGroupId !== group.id || itemIds.has(item.id))
        return false
      itemIds.add(item.id)
    }
    itemCount += group.items.length
    if (itemCount > 100000)
      return false
  }
  return true
}

function matchesSnapshotScope(value: unknown, expectedOrigin: string, expectedAccountId: number) {
  if (!isRecord(value))
    return false
  return value.serverOrigin === expectedOrigin
    && value.accountId === expectedAccountId
    && isTimestamp(value.savedAt)
    && isBootstrapResponseV1(value.data)
    && value.data.account.id === expectedAccountId
}

function normalizeSnapshotEnvelope(
  value: unknown,
  expectedOrigin: string,
  expectedAccountId: number,
): BootstrapSnapshotEnvelope | null {
  if (!matchesSnapshotScope(value, expectedOrigin, expectedAccountId))
    return null
  const scoped = value as unknown as LegacyBootstrapSnapshotEnvelope | BootstrapSnapshotEnvelope
  if (scoped.cacheVersion === 1) {
    return {
      cacheVersion: BOOTSTRAP_SNAPSHOT_CACHE_VERSION,
      serverOrigin: scoped.serverOrigin,
      accountId: scoped.accountId,
      savedAt: scoped.savedAt,
      cursorRevision: scoped.data.revision,
      data: scoped.data,
    }
  }
  if (scoped.cacheVersion !== BOOTSTRAP_SNAPSHOT_CACHE_VERSION
    || !isSyncRevision(scoped.cursorRevision)
    || scoped.cursorRevision !== scoped.data.revision) {
    return null
  }
  return scoped
}

export function serializeBootstrapSnapshot(
  data: unknown,
  serverOrigin: string,
  expectedAccountId: number,
  savedAt = new Date().toISOString(),
): string | null {
  if (!isServerOrigin(serverOrigin) || !isSafeId(expectedAccountId) || !isTimestamp(savedAt) || !isBootstrapResponseV1(data))
    return null
  if (data.account.id !== expectedAccountId)
    return null
  const envelope: BootstrapSnapshotEnvelope = {
    cacheVersion: BOOTSTRAP_SNAPSHOT_CACHE_VERSION,
    serverOrigin,
    accountId: expectedAccountId,
    savedAt,
    cursorRevision: data.revision,
    data,
  }
  const serialized = JSON.stringify(envelope)
  return utf8Size(serialized) <= MAX_BOOTSTRAP_SNAPSHOT_BYTES ? serialized : null
}

export function parseBootstrapSnapshot(
  raw: string | null,
  expectedOrigin: string,
  expectedAccountId: number,
): BootstrapSnapshotEnvelope | null {
  if (!raw || raw.length > MAX_BOOTSTRAP_SNAPSHOT_BYTES || !isServerOrigin(expectedOrigin) || !isSafeId(expectedAccountId))
    return null
  if (utf8Size(raw) > MAX_BOOTSTRAP_SNAPSHOT_BYTES)
    return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return normalizeSnapshotEnvelope(parsed, expectedOrigin, expectedAccountId)
  }
  catch {
    return null
  }
}
