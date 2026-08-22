import type { WidgetDefinition } from './types'
import { WIDGET_TYPE_PATTERN } from './constants'

/**
 * 第三方组件注册入口（类型推导 + 前置校验）。
 *
 * 用法：
 * ```ts
 * export default defineWidget({
 *   type: 'acme.stock',
 *   currentVersion: 1,
 *   configSchema: defineConfigSchema({ symbol: field.string({ default: 'AAPL' }) }),
 *   defaultConfig: () => ({ symbol: 'AAPL' }),
 *   size: { default: { columns: 3, rows: 2 }, min: { columns: 2, rows: 1 }, max: { columns: 6, rows: 4 } },
 *   meta: { title: '股票行情' },
 *   load: () => import('./StockWidget.vue').then(m => m.default),
 * })
 * ```
 *
 * 返回原定义对象（结构不变），价值在于：
 * - TConfig 全链路类型推导；
 * - 在模块加载期即刻暴露 type 命名/尺寸约束错误，而不是等到 register()。
 */
export function defineWidget<TConfig>(definition: WidgetDefinition<TConfig>): WidgetDefinition<TConfig> {
  if (!WIDGET_TYPE_PATTERN.test(definition.type))
    throw new Error(`defineWidget: invalid widget type "${definition.type}". Expected /${WIDGET_TYPE_PATTERN.source}/, recommended format "<vendor>.<name>".`)
  if (definition.meta && !definition.meta.title?.trim())
    throw new Error(`defineWidget(${definition.type}): meta.title must be a non-empty string.`)
  return definition
}
