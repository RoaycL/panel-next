import type { ThemeDefinition } from '../types'
import { extensionDefaultTokens } from '../tokens'

/**
 * core.default：内置默认主题。
 * 视觉上保持 Panel Next 当前默认风格（壁纸 + 半透明深色表面），
 * 旧外观字段（backgroundImageSrc/backgroundBlur/backgroundMaskNumber/iconTextColor 等）
 * 通过 legacyAdapter 继续生效，本主题不重复声明。
 */
export const defaultTheme: ThemeDefinition<Record<string, never>> = {
  id: 'core.default',
  version: 1,
  meta: {
    name: 'Panel Next Default',
    description: 'theme.default.description',
    author: 'Panel Next',
  },
  surfaces: ['web', 'extension'],
  // The current monochrome acrylic UI is the actual, exportable default theme.
  tokens: { light: extensionDefaultTokens('light'), dark: extensionDefaultTokens('dark') },
  variants: {
    bookmark: 'glass',
    widget: 'glass',
    sidebar: 'floating',
    search: 'pill',
  },
  configSchema: {
    parse: value => (value && typeof value === 'object' && !Array.isArray(value) ? {} : {}),
    fields: {},
  },
  defaultConfig: () => ({}),
}
