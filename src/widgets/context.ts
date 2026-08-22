import type { InjectionKey } from 'vue'
import { inject } from 'vue'
import { getRuntime } from '@/runtime'
import type { WidgetCapability, WidgetSurface } from './types'
import { assertContextCapability, WidgetPermissionError } from './capabilities'

const MAX_WIDGET_STORAGE_KEY_LENGTH = 64
const MAX_WIDGET_STORAGE_VALUE_BYTES = 128 * 1024
const MAX_WIDGET_STORAGE_TOTAL_BYTES = 512 * 1024

/**
 * 宿主注入给每个组件实例的运行时上下文。
 * 组件内通过 useWidgetContext() 获取，禁止直接依赖宿主视图层。
 */
export interface WidgetContext {
  /** 当前实例 ID（同类型可多实例） */
  instanceId: string
  /** 组件类型标识，如 core.clock */
  type: string
  /** 仪表盘是否处于布局编辑模式（编辑态下组件应暂停轮询/动画等重操作） */
  editMode: boolean
  capabilities: readonly WidgetCapability[]
  surface: WidgetSurface
}

export const WIDGET_CONTEXT_KEY: InjectionKey<WidgetContext> = Symbol('panel-next-widget-context')

/**
 * 获取宿主注入的组件上下文；脱离宿主（独立预览/测试）时返回 null，
 * 组件必须对 null 做降级处理，不得硬依赖。
 */
export function useWidgetContext(): WidgetContext | null {
  return inject(WIDGET_CONTEXT_KEY, null)
}

const WIDGET_STORAGE_PREFIX = 'PANEL_NEXT_WIDGET_V1.'

function instanceStoragePrefix(instanceId: string) {
  return `${WIDGET_STORAGE_PREFIX}${instanceId.length}:${instanceId}:`
}

function storageKey(instanceId: string, key: string) {
  if (!/^[\w.-]+$/.test(key) || key.length > MAX_WIDGET_STORAGE_KEY_LENGTH)
    throw new Error('Invalid widget storage key.')
  return `${instanceStoragePrefix(instanceId)}${key.length}:${key}`
}

function utf8Size(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function assertStorageCapability(context: WidgetContext | null, instanceId?: string): asserts context is WidgetContext {
  // 严格拒绝策略：脱离宿主（独立预览/测试）同样视为未授权，
  // 预览环境请手动 provide 一个带 capabilities 的上下文。
  assertContextCapability(context, 'storage')
  if (instanceId && context.instanceId !== instanceId) {
    throw new WidgetPermissionError('storage', `Widget instance ID mismatch: expected "${context.instanceId}", got "${instanceId}".`)
  }
}

/**
 * 组件私有命名空间存储：按实例 ID 隔离，自动跟随运行时
 * （Web 端与扩展端各自的 storage 适配器），组件不得直接访问浏览器存储 API。
 * 声明了 'storage' 能力的组件才应使用。
 */
export function useWidgetStorage(instanceId?: string) {
  const context = useWidgetContext()
  assertStorageCapability(context, instanceId)
  const resolvedInstanceId = instanceId ?? context.instanceId
  const read = <T = unknown>(key: string): T | null => {
    const raw = getRuntime().storage.getItem(storageKey(resolvedInstanceId, key))
    if (raw === null)
      return null
    try {
      return JSON.parse(raw) as T
    }
    catch {
      return null
    }
  }
  const write = async (key: string, value: unknown): Promise<boolean> => {
    try {
      const storage = getRuntime().storage
      const targetKey = storageKey(resolvedInstanceId, key)
      const serialized = JSON.stringify(value)
      if (typeof serialized !== 'string' || utf8Size(serialized) > MAX_WIDGET_STORAGE_VALUE_BYTES)
        return false
      const prefix = instanceStoragePrefix(resolvedInstanceId)
      const currentBytes = storage.keys?.()
        .filter(candidate => candidate.startsWith(prefix) && candidate !== targetKey)
        .reduce((total, candidate) => total + utf8Size(storage.getItem(candidate) || ''), 0) ?? 0
      if (currentBytes + utf8Size(serialized) > MAX_WIDGET_STORAGE_TOTAL_BYTES)
        return false
      storage.setItem(targetKey, serialized)
      await storage.flush?.()
      return true
    }
    catch {
      return false
    }
  }
  const remove = async (key: string): Promise<void> => {
    const storage = getRuntime().storage
    storage.removeItem(storageKey(resolvedInstanceId, key))
    await storage.flush?.()
  }
  return { read, write, remove }
}

export async function clearWidgetStorage(instanceId: string): Promise<boolean> {
  const storage = getRuntime().storage
  const prefix = instanceStoragePrefix(instanceId)
  const matchingKeys = storage.keys?.().filter(key => key.startsWith(prefix)) ?? []
  if (matchingKeys.length === 0)
    return true

  const snapshots: Array<[string, string]> = []
  for (const k of matchingKeys) {
    const val = storage.getItem(k)
    if (val !== null)
      snapshots.push([k, val])
  }

  for (const k of matchingKeys) {
    storage.removeItem(k)
  }

  try {
    await storage.flush?.()
    return true
  }
  catch (error) {
    for (const [k, val] of snapshots) {
      storage.setItem(k, val)
    }
    try {
      await storage.flush?.()
    }
    catch {}
    throw error
  }
}
