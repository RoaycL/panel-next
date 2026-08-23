import type { WidgetInstance, WidgetSize } from './types'
import { MAX_WIDGET_STACK_SIZE } from './types'

export interface WidgetDisplayGroup {
  key: string
  stackId: string | null
  members: WidgetInstance[]
  size: WidgetSize
}

function sameWidgetSize(left: WidgetSize, right: WidgetSize) {
  return left.columns === right.columns && left.rows === right.rows
}

function stackKey(instance: WidgetInstance) {
  return instance.stack?.id ?? instance.id
}

function generateStackId(instances: readonly WidgetInstance[]) {
  const existing = new Set(instances.map(instance => instance.stack?.id).filter(Boolean))
  let id = ''
  do {
    id = `stack.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 9)}`
  } while (existing.has(id))
  return id.slice(0, 64)
}

/**
 * 把扁平传输结构转换为宿主显示单元。堆栈只占一个网格位置；成员仍各自保留
 * 配置、版本与私有存储，因而不破坏第三方组件契约。
 */
export function buildWidgetDisplayGroups(
  instances: readonly WidgetInstance[],
  includeHidden = false,
): WidgetDisplayGroup[] {
  const grouped = new Map<string, WidgetInstance[]>()
  const order: string[] = []
  for (const instance of instances) {
    const key = stackKey(instance)
    if (!grouped.has(key)) {
      grouped.set(key, [])
      order.push(key)
    }
    grouped.get(key)?.push(instance)
  }
  return order.flatMap((key) => {
    const allMembers = grouped.get(key) ?? []
    const members = [...allMembers].sort((left, right) => (left.stack?.order ?? 0) - (right.stack?.order ?? 0))
    const visibleMembers = includeHidden ? members : members.filter(member => !member.hidden)
    if (!visibleMembers.length)
      return []
    return [{
      key,
      stackId: members.length > 1 && members[0].stack ? members[0].stack.id : null,
      members: visibleMembers,
      size: { ...members[0].size },
    }]
  })
}

/** 修复旧数据或并发合并产生的孤立/越界堆栈，并返回是否发生变化。 */
export function normalizeWidgetStacks(instances: WidgetInstance[]) {
  let changed = false
  const stacks = new Map<string, WidgetInstance[]>()
  for (const instance of instances) {
    if (!instance.stack)
      continue
    const members = stacks.get(instance.stack.id) ?? []
    members.push(instance)
    stacks.set(instance.stack.id, members)
  }
  for (const members of stacks.values()) {
    members.sort((left, right) => (left.stack?.order ?? 0) - (right.stack?.order ?? 0))
    const baseSize = members[0]?.size
    const validMembers = members.filter((member, index) => index < MAX_WIDGET_STACK_SIZE && baseSize && sameWidgetSize(member.size, baseSize))
    if (validMembers.length < 2) {
      for (const member of members) {
        if (member.stack) {
          delete member.stack
          changed = true
        }
      }
      continue
    }
    const validIds = new Set(validMembers.map(member => member.id))
    validMembers.forEach((member, order) => {
      if (member.stack?.order !== order) {
        member.stack = { id: member.stack?.id ?? '', order }
        changed = true
      }
    })
    for (const member of members) {
      if (!validIds.has(member.id) && member.stack) {
        delete member.stack
        changed = true
      }
    }
  }
  return changed
}

export function canStackWidgets(instances: readonly WidgetInstance[], sourceId: string, targetId: string) {
  if (sourceId === targetId)
    return false
  const source = instances.find(instance => instance.id === sourceId)
  const target = instances.find(instance => instance.id === targetId)
  if (!source || !target || source.hidden || target.hidden || !sameWidgetSize(source.size, target.size))
    return false
  const sourceKey = stackKey(source)
  const targetKey = stackKey(target)
  if (sourceKey === targetKey)
    return false
  const combinedSize = instances.filter(instance => stackKey(instance) === sourceKey || stackKey(instance) === targetKey).length
  return combinedSize <= MAX_WIDGET_STACK_SIZE
}

/** 把 source 所在显示单元合并到 target 所在显示单元，target 保持为第一张。 */
export function stackWidgets(instances: WidgetInstance[], sourceId: string, targetId: string): string | null {
  if (!canStackWidgets(instances, sourceId, targetId))
    return null
  const source = instances.find(instance => instance.id === sourceId) as WidgetInstance
  const target = instances.find(instance => instance.id === targetId) as WidgetInstance
  const sourceKey = stackKey(source)
  const targetKey = stackKey(target)
  const targetMembers = instances.filter(instance => stackKey(instance) === targetKey)
    .sort((left, right) => (left.stack?.order ?? 0) - (right.stack?.order ?? 0))
  const sourceMembers = instances.filter(instance => stackKey(instance) === sourceKey)
    .sort((left, right) => (left.stack?.order ?? 0) - (right.stack?.order ?? 0))
  const stackId = target.stack?.id ?? generateStackId(instances)
  const combined = [...targetMembers, ...sourceMembers]
  combined.forEach((member, order) => { member.stack = { id: stackId, order } })

  const memberIds = new Set(combined.map(member => member.id))
  const insertionIndex = Math.min(...combined.map(member => instances.indexOf(member)))
  const remaining = instances.filter(instance => !memberIds.has(instance.id))
  remaining.splice(insertionIndex, 0, ...combined)
  instances.splice(0, instances.length, ...remaining)
  return stackId
}

export function unstackWidget(instances: WidgetInstance[], widgetId: string) {
  const instance = instances.find(widget => widget.id === widgetId)
  if (!instance?.stack)
    return false
  const stackId = instance.stack.id
  delete instance.stack
  normalizeWidgetStacks(instances)
  const remaining = instances.filter(widget => widget.stack?.id === stackId)
  remaining.forEach((member, order) => { member.stack = { id: stackId, order } })
  return true
}

export function moveWidgetWithinStack(instances: WidgetInstance[], widgetId: string, delta: number) {
  const instance = instances.find(widget => widget.id === widgetId)
  if (!instance?.stack || !Number.isInteger(delta) || delta === 0)
    return false
  const members = instances.filter(widget => widget.stack?.id === instance.stack?.id)
    .sort((left, right) => (left.stack?.order ?? 0) - (right.stack?.order ?? 0))
  const current = members.indexOf(instance)
  const next = Math.min(members.length - 1, Math.max(0, current + delta))
  if (current === next)
    return false
  members.splice(current, 1)
  members.splice(next, 0, instance)
  members.forEach((member, order) => { member.stack = { id: instance.stack?.id ?? '', order } })
  return true
}

/** 按显示单元排序，同时保持隐藏单元原有槽位与堆栈成员连续。 */
export function applyWidgetDisplayOrder(instances: WidgetInstance[], orderedKeys: readonly string[]) {
  const containers = buildWidgetDisplayGroups(instances, true)
  const byKey = new Map(containers.map(group => [group.key, group.members]))
  const visibleKeys = new Set(buildWidgetDisplayGroups(instances, false).map(group => group.key))
  const requested = orderedKeys.filter(key => visibleKeys.has(key) && byKey.has(key))
  if (requested.length !== visibleKeys.size)
    return false
  let visibleIndex = 0
  const reordered = containers.flatMap((group) => {
    if (!visibleKeys.has(group.key))
      return group.members
    return byKey.get(requested[visibleIndex++]) ?? []
  })
  instances.splice(0, instances.length, ...reordered)
  return true
}

/** 序列化前统一位置：同一堆栈共享一个网格槽位。 */
export function normalizeWidgetPositions(instances: readonly WidgetInstance[]) {
  let row = 0
  return buildWidgetDisplayGroups(instances, true).flatMap((group) => {
    const position = { column: 0, row: row++ }
    return group.members.map(instance => ({ ...instance, position: { ...position } }))
  })
}
