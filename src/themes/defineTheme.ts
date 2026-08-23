import type { ThemeDefinition } from './types'

/**
 * 可信源码主题的类型安全入口。
 *
 * 源码主题拥有应用代码权限，必须随应用一起打包并经过审核；
 * 不能作为普通用户上传包执行，也不允许绕过 Runtime、Storage 与安全导航接口。
 */
export function defineTheme<T>(definition: ThemeDefinition<T>): Readonly<ThemeDefinition<T>> {
  return Object.freeze(definition)
}
