/**
 * JSON 安全深克隆。
 *
 * Theme SDK 在 manifest `minimum_chrome_version=96` 下运行，但浏览器直到
 * Chrome 98 才提供全局 `structuredClone`。为避免直接依赖它，Theme SDK 统一
 * 使用本函数做 JSON 安全克隆（Token 树、配置、图标集均为纯 JSON 数据，
 * 不含 Function / Date / Map 等需要 structuredClone 语义的类型）。
 *
 * 语义：
 * - null 保留为 null；undefined 原样返回；
 * - 对象 / 数组深拷贝；对象内 undefined 键会被 JSON 化掉（与 wire 序列化一致）；
 * - 任何不可被 JSON 序列化的值（循环引用 / BigInt / symbol 值）会抛错，调用方据此拒绝。
 */
export function cloneJson<T>(value: T): T {
  if (value === undefined)
    return value
  if (value === null || typeof value !== 'object')
    return value
  return JSON.parse(JSON.stringify(value)) as T
}
