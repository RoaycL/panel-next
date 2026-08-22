import type { WidgetCapability } from './types'
import type { WidgetContext } from './context'
import { useWidgetContext } from './context'

/** 能力未授权、脱离宿主或实例不匹配时抛出；宿主错误边界会展示占位，组件也可自行捕获降级。 */
export class WidgetPermissionError extends Error {
  constructor(readonly capability: WidgetCapability, message?: string) {
    super(message ?? `Widget capability "${capability}" was not granted or is unavailable outside a widget host.`)
    this.name = 'WidgetPermissionError'
  }
}

/**
 * 纯函数能力检查：根据传入的 WidgetContext 判断是否具备指定能力。
 */
export function hasContextCapability(context: WidgetContext | null | undefined, capability: WidgetCapability): boolean {
  return Boolean(context && Array.isArray(context.capabilities) && context.capabilities.includes(capability))
}

/**
 * 纯函数能力断言：未授权或脱离宿主时抛出 WidgetPermissionError。
 */
export function assertContextCapability(
  context: WidgetContext | null | undefined,
  capability: WidgetCapability,
  customMessage?: string,
): asserts context is WidgetContext {
  if (!hasContextCapability(context, capability)) {
    throw new WidgetPermissionError(capability, customMessage)
  }
}

/**
 * 运行时能力授权检查（在 Vue setup 上下文中便捷调用）。
 *
 * 重要语义：这是宿主内的授权闸门（声明制），不是安全沙箱——
 * 被构建进项目的组件代码天然拥有页面权限。它保证：
 * 1. 组件必须显式声明 capabilities 才能拿到对应宿主封装；
 * 2. 未授权调用会快速失败并给出可诊断的错误；
 * 3. 审核与安全审计可以静态对照声明与实际调用。
 * 真正的第三方代码隔离需要独立沙箱与签名机制（见文档「边界」章节）。
 */
export function hasCapability(capability: WidgetCapability): boolean {
  const context = useWidgetContext()
  return hasContextCapability(context, capability)
}

export function assertCapability(capability: WidgetCapability): void {
  const context = useWidgetContext()
  assertContextCapability(context, capability)
}
