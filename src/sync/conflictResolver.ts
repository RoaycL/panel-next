import type { OfflineMutation } from './offlineQueue'

export interface ConflictDescriptor {
  idempotencyKey: string
  action: OfflineMutation['action']
  resourceType: 'item' | 'group' | 'panel'
  resourceId?: string | number
  resourceName: string
  localVersion: {
    timestamp: string
    baseRevision: Sync.Revision | null
    data: any
  }
  remoteVersion: {
    timestamp?: string
    revision: Sync.Revision
    data: any
  }
  diffFields: string[]
  reason: string
}

export type ConflictResolutionChoice = 'keep_local' | 'keep_remote' | 'duplicate_local'

/**
 * 字段对比工具：查找两个对象之间不一致的业务属性
 */
export function getObjectDiffFields(local: Record<string, any>, remote: Record<string, any>, fieldsToCheck: string[]): string[] {
  const diffs: string[] = []
  for (const field of fieldsToCheck) {
    const valL = local ? local[field] : undefined
    const valR = remote ? remote[field] : undefined
    if (typeof valL === 'object' || typeof valR === 'object') {
      if (JSON.stringify(valL) !== JSON.stringify(valR)) {
        diffs.push(field)
      }
    }
    else if (valL !== valR) {
      diffs.push(field)
    }
  }
  return diffs
}

/** 面板配置全量业务字段：任何一项离线改动与云端不一致都应触发裁决（S4）。 */
export const PANEL_CONFIG_CONFLICT_FIELDS = [
  'backgroundImageSrc',
  'backgroundBlur',
  'backgroundMaskNumber',
  'iconStyle',
  'iconTextColor',
  'iconTextInfoHideDescription',
  'iconTextIconHideTitle',
  'logoText',
  'logoImageSrc',
  'logoShow',
  'clockShowSecond',
  'clockColor',
  'clockShow',
  'searchBoxShow',
  'searchBoxSearchIcon',
  'marginTop',
  'marginBottom',
  'maxWidth',
  'maxWidthUnit',
  'marginX',
  'footerHtml',
  'systemMonitorShow',
  'systemMonitorShowTitle',
  'systemMonitorPublicVisitModeShow',
  'netModeChangeButtonShow',
  'widgets',
] as const

const ITEM_CONFLICT_FIELDS = ['title', 'url', 'lanUrl', 'description', 'icon', 'openMethod', 'itemIconGroupId', 'sort']

const hasTrustedBase = (mutation: OfflineMutation): boolean => mutation.baseRevision !== null

const isRemoteAhead = (remoteRevision: Sync.Revision, baseRevision: Sync.Revision): boolean => {
  try {
    return BigInt(remoteRevision) > BigInt(baseRevision)
  }
  catch {
    return false
  }
}

/**
 * OFFLINE-02: 针对各类操作进行细粒度冲突语义判定
 */
export function evaluateConflict(
  mutation: OfflineMutation,
  remoteData: Sync.BootstrapResponseV1 | null,
): ConflictDescriptor | null {
  if (!remoteData) return null

  // 1. 新增操作 (item.add, group.add) -> 天然无冲突追加
  if (mutation.action === 'item.add' || mutation.action === 'group.add') {
    return null
  }

  // 2. 删除操作 (item.delete, group.delete)
  if (mutation.action === 'item.delete') {
    const targetId = Number(mutation.resourceId || (mutation.payload as any)?.ids?.[0])
    const remoteItemExists = remoteData.panel.groups.some(g => g.items.some(it => it.id === targetId))
    // 如果远程已经不存在该项，幂等视为已删除，无冲突
    if (!remoteItemExists) return null
    return null
  }

  if (mutation.action === 'group.delete') {
    const targetId = Number(mutation.resourceId || (mutation.payload as any)?.ids?.[0])
    const remoteGroupExists = remoteData.panel.groups.some(g => g.id === targetId)
    if (!remoteGroupExists) return null
    return null
  }

  // 3. 排序操作 (item.sort, group.sort)
  if (mutation.action === 'item.sort' || mutation.action === 'group.sort') {
    // 排序变更通常可以直接重放或收敛，不强制中断
    return null
  }

  // 4. 编辑卡片 (item.edit)
  if (mutation.action === 'item.edit') {
    const payload = mutation.payload as Panel.ItemInfo
    const itemId = payload.id
    let remoteItem: Panel.ItemInfo | null = null
    for (const g of remoteData.panel.groups) {
      const it = g.items.find(i => i.id === itemId)
      if (it) {
        remoteItem = it
        break
      }
    }

    if (!remoteItem) {
      // 远程已被他人删除
      return {
        idempotencyKey: mutation.idempotencyKey,
        action: mutation.action,
        resourceType: 'item',
        resourceId: itemId,
        resourceName: payload.title || '快捷书签',
        localVersion: {
          timestamp: mutation.createdAt,
          baseRevision: mutation.baseRevision,
          data: payload,
        },
        remoteVersion: {
          revision: remoteData.revision,
          data: null,
        },
        diffFields: ['status'],
        reason: '该书签在云端已被其他端删除',
      }
    }

    // 检查字段是否有实际冲突。基线不可信时跳过字段级判定，仅依赖「云端已删除」检测，
    // 避免用未知基线把正常的云端变更误报为冲突。
    if (!hasTrustedBase(mutation))
      return null

    const diffs = getObjectDiffFields(payload as any, remoteItem as any, ITEM_CONFLICT_FIELDS)

    if (diffs.length > 0 && isRemoteAhead(remoteData.revision, mutation.baseRevision!)) {
      return {
        idempotencyKey: mutation.idempotencyKey,
        action: mutation.action,
        resourceType: 'item',
        resourceId: itemId,
        resourceName: payload.title || remoteItem.title || '快捷书签',
        localVersion: {
          timestamp: mutation.createdAt,
          baseRevision: mutation.baseRevision,
          data: payload,
        },
        remoteVersion: {
          timestamp: remoteItem.updateTime,
          revision: remoteData.revision,
          data: remoteItem,
        },
        diffFields: diffs,
        reason: `云端自上次同步后已有新的修改 (冲突属性: ${diffs.join(', ')})`,
      }
    }
    return null
  }

  // 5. 编辑分组 (group.edit)
  if (mutation.action === 'group.edit') {
    const payload = mutation.payload as Panel.ItemIconGroup
    const groupId = payload.id
    const remoteGroup = remoteData.panel.groups.find(g => g.id === groupId)

    if (!remoteGroup) {
      return {
        idempotencyKey: mutation.idempotencyKey,
        action: mutation.action,
        resourceType: 'group',
        resourceId: groupId,
        resourceName: payload.title || '分组',
        localVersion: {
          timestamp: mutation.createdAt,
          baseRevision: mutation.baseRevision,
          data: payload,
        },
        remoteVersion: {
          revision: remoteData.revision,
          data: null,
        },
        diffFields: ['status'],
        reason: '该分组在云端已被其他端删除',
      }
    }

    if (!hasTrustedBase(mutation))
      return null

    const diffs = getObjectDiffFields(payload as any, remoteGroup as any, ['title', 'icon', 'description'])
    if (diffs.length > 0 && isRemoteAhead(remoteData.revision, mutation.baseRevision!)) {
      return {
        idempotencyKey: mutation.idempotencyKey,
        action: mutation.action,
        resourceType: 'group',
        resourceId: groupId,
        resourceName: payload.title || remoteGroup.title || '分组',
        localVersion: {
          timestamp: mutation.createdAt,
          baseRevision: mutation.baseRevision,
          data: payload,
        },
        remoteVersion: {
          timestamp: remoteGroup.updateTime,
          revision: remoteData.revision,
          data: remoteGroup,
        },
        diffFields: diffs,
        reason: `云端分组信息已发生变动 (冲突属性: ${diffs.join(', ')})`,
      }
    }
    return null
  }

  // 6. 面板配置 (panel.set)
  if (mutation.action === 'panel.set') {
    if (!hasTrustedBase(mutation))
      return null
    const payload = mutation.payload as { panel?: Panel.panelConfig }
    const localPanel = payload.panel || {}
    const remotePanel = (remoteData.panel.config || {}) as Panel.panelConfig

    const diffs = getObjectDiffFields(localPanel, remotePanel, [...PANEL_CONFIG_CONFLICT_FIELDS])

    if (diffs.length > 0 && isRemoteAhead(remoteData.revision, mutation.baseRevision!)) {
      return {
        idempotencyKey: mutation.idempotencyKey,
        action: mutation.action,
        resourceType: 'panel',
        resourceName: '系统面板样式与组件布局',
        localVersion: {
          timestamp: mutation.createdAt,
          baseRevision: mutation.baseRevision,
          data: localPanel,
        },
        remoteVersion: {
          revision: remoteData.revision,
          data: remotePanel,
        },
        diffFields: diffs,
        reason: `云端面板样式在离线期间已被修改 (冲突属性: ${diffs.join(', ')})`,
      }
    }
    return null
  }

  return null
}
