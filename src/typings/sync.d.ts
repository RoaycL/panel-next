declare namespace Sync {
  /** A non-negative base-10 integer serialized as text to preserve 64-bit precision. */
  type Revision = string

  interface BootstrapResponseV1 {
    schemaVersion: 1
    revision: Revision
    generatedAt: string
    account: BootstrapAccount
    panel: BootstrapPanel
  }

  type BootstrapResponse = BootstrapResponseV1

  type ChangeResourceType = 'panel' | 'group' | 'item'
  type ChangeOperation = 'upsert' | 'delete'

  interface ChangeV1 {
    revision: Revision
    resourceType: ChangeResourceType
    resourceId: string
    operation: ChangeOperation
    changedAt: string
    data: unknown | null
  }

  interface ChangesResponseV1 {
    schemaVersion: 1
    fromRevision: Revision
    nextRevision: Revision
    currentRevision: Revision
    hasMore: boolean
    changes: ChangeV1[]
  }

  interface BootstrapAccount {
    id: number
    username: string
    name: string
    headImage: string
    role: number
    mail: string
    status: number
  }

  interface BootstrapPanel {
    revision: Revision
    config: Panel.panelConfig
    searchEngine: Record<string, unknown>
    groups: BootstrapGroup[]
  }

  interface BootstrapGroup {
    id: number
    createTime: string
    updateTime: string
    icon: string
    title: string
    description: string
    sort: number
    revision: Revision
    items: BootstrapItem[]
  }

  interface BootstrapItem {
    id: number
    createTime: string
    updateTime: string
    icon: Panel.ItemIcon
    title: string
    url: string
    lanUrl: string
    description: string
    openMethod: number
    sort: number
    revision: Revision
    itemIconGroupId: number
  }
}
