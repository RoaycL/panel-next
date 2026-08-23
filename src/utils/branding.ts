import { defaultFooterHtml } from './defaultFooter'

/**
 * 品牌迁移：旧版本（Sun-Panel）写入的用户配置可能携带指向原项目仓库的页脚。
 * 仅当页脚命中历史品牌特征（原仓库链接 / Powered By Sun-Panel 文案）时
 * 才替换为 Panel Next 默认页脚；用户自定义的其他页脚不受影响。
 */
const LEGACY_BRANDING_PATTERN = new RegExp(
  'hslr-s/sun-panel'
  + '|powered\\s*by[^<]*sun-?panel',
  'i',
)

export function isLegacyBrandedFooter(html: unknown): boolean {
  return typeof html === 'string' && LEGACY_BRANDING_PATTERN.test(html)
}

export function migrateLegacyFooterHtml<T extends { footerHtml?: string }>(config: T): T {
  if (!isLegacyBrandedFooter(config.footerHtml))
    return config
  return { ...config, footerHtml: defaultFooterHtml }
}
