import type { InjectionKey } from 'vue'
import { inject } from 'vue'
import { getRuntime } from '@/runtime'

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

function storageKey(instanceId: string, key: string) {
  return `${WIDGET_STORAGE_PREFIX}${instanceId}.${key}`
}

/**
 * 组件私有命名空间存储：按实例 ID 隔离，自动跟随运行时
 * （Web 端与扩展端各自的 storage 适配器），组件不得直接访问浏览器存储 API。
 * 声明了 'storage' 能力的组件才应使用。
 */
export function useWidgetStorage(instanceId: string) {
  const read = <T = unknown>(key: string): T | null => {
    const raw = getRuntime().storage.getItem(storageKey(instanceId, key))
    if (raw === null)
      return null
    try {
      return JSON.parse(raw) as T
    }
    catch {
      return null
    }
  }
  const write = (key: string, value: unknown): boolean => {
    try {
      getRuntime().storage.setItem(storageKey(instanceId, key), JSON.stringify(value))
      return true
    }
    catch {
      return false
    }
  }
  const remove = (key: string): void => {
    getRuntime().storage.removeItem(storageKey(instanceId, key))
  }
  return { read, write, remove }
}
