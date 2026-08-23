import type {
  ThemeDefinition,
  ThemeIconSet,
  ThemeSelection,
  ThemeTokenOverrides,
  ThemeVariantOverrides,
} from './types'
import { SHA256 } from 'crypto-js'
import { THEME_ICON_NAMES, MAX_THEME_CONFIG_BYTES } from './types'
import { validateThemeWireSelection, validateVariantOverrides, jsonSize } from './schema'
import { DEFAULT_THEME_ID, THEME_ID_PATTERN } from './constants'
import { completeTokens, freezeTokens, DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS } from './tokens'
import { tokensToCssVariables } from './cssVariables'
import { isIconifyName, isLocalSpriteName } from './icons'
import { cloneJson } from './clone'

/**
 * 数据化安全主题包（v1 契约）。
 *
 * 包格式：`theme.json` 清单 + preview + 本地 assets/icons。
 * - 只允许 Token、配置描述、Variant、图标映射和资源清单；
 * - 禁止 JavaScript、Vue、HTML、远程脚本和任意 CSS 选择器；
 * - 禁止路径穿越、绝对路径和符号链接；
 * - 图片/字体/SVG 使用 MIME 白名单并与扩展名/魔数匹配；URL 仅允许安全本地资源或 HTTP(S) 页面链接。
 *
 * 当前阶段不实现主题商店与远程自动更新；ZIP 容器解包由导入方完成，
 * 本模块校验并转换解包后的清单。
 */

export interface ThemePackageManifestV1 {
  format: 'panel-next-theme-package'
  formatVersion: 1
  theme: {
    id: string
    version: number
    meta: ThemeDefinition['meta']
    surfaces?: readonly string[]
    variants?: ThemeVariantOverrides
    icons?: Record<string, string>
    tokens?: {
      light?: ThemeTokenOverrides
      dark?: ThemeTokenOverrides
    }
    configDefaults?: Record<string, unknown>
  }
  assets?: Record<string, { mimeType: string, dataBase64: string }>
}

export const THEME_PACKAGE_MAX_TOTAL_BYTES = 10 * 1024 * 1024
export const THEME_PACKAGE_MAX_ASSET_BYTES = 2 * 1024 * 1024
export const THEME_PACKAGE_MAX_PREVIEW_BYTES = 1 * 1024 * 1024
export const THEME_PACKAGE_MAX_ASSETS = 100

const ASSET_MIME_WHITELIST = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
  'font/woff', 'font/woff2',
])

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

/** 资源路径白名单：相对路径、不含 ..、不以 / 开头、无反斜杠与盘符。 */
export function isSafeAssetPath(path: string): boolean {
  if (typeof path !== 'string' || !path || path.length > 128)
    return false
  if (path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path))
    return false
  if (path.split('/').some(segment => segment === '' || segment === '.' || segment === '..'))
    return false
  return /^\w[\w./-]*$/.test(path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const BASE64_PATTERN = /^[A-Z\d+/]+={0,2}$/i

/**
 * 无依赖的 Base64 → 二进制字符串解码器。
 * 浏览器优先使用 atob；Node/测试环境无 atob 时走纯 JS 实现，
 * 避免在浏览器构建中引入 node:buffer polyfill（Vite 不解析 node: 内置模块）。
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64ToBinary(normalized: string): string {
  let binary = ''
  let buffer = 0
  let bits = 0
  for (const character of normalized) {
    if (character === '=')
      break
    const value = BASE64_CHARS.indexOf(character)
    if (value < 0)
      return '' // 非法字符；由上层按失败处理
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      binary += String.fromCharCode((buffer >> bits) & 0xff)
    }
  }
  return binary
}

/** 校验 Base64 格式并返回解码后的真实字节长度；非法时返回 null。 */
function decodeBase64Size(dataBase64: string): { bytes: Uint8Array, size: number } | null {
  const normalized = dataBase64.replace(/[\r\n]/g, '')
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized))
    return null
  try {
    const binary = typeof atob === 'function' ? atob(normalized) : base64ToBinary(normalized)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { bytes, size: bytes.length }
  }
  catch {
    return null
  }
}

/** 魔数嗅探：MIME 必须与文件头匹配，防止伪装扩展名。 */
function matchesMagic(mimeType: string, bytes: Uint8Array): boolean {
  const head = Array.from(bytes.slice(0, 12))
  const startsWith = (...values: number[]) => values.every((byte, i) => head[i] === byte)
  switch (mimeType) {
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4E, 0x47)
    case 'image/jpeg':
      return startsWith(0xFF, 0xD8, 0xFF)
    case 'image/gif':
      return startsWith(0x47, 0x49, 0x46)
    case 'image/webp':
      return startsWith(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57
    case 'font/woff':
      return startsWith(0x77, 0x4F, 0x46, 0x46)
    case 'font/woff2':
      return startsWith(0x77, 0x4F, 0x46, 0x32)
    case 'image/svg+xml':
      // SVG 是文本：允许 BOM/空白后出现 <svg 或 <?xml。
      return /<\?xml|<svg/i.test(new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 256)))
    default:
      return false
  }
}

/**
 * SVG 内容安全扫描（全量解码后检查）：
 * 拒绝脚本、事件属性、foreignObject、外部引用与 CSS url() 等。
 */
export function containsDangerousSvgContent(svgText: string): boolean {
  const patterns = [
    /<script/i,
    /\son[a-z]+\s*=/i,
    /<foreignObject/i,
    /<use[^>]+(?:href|xlink:href)\s*=\s*["']?\s*(?!#)/i,
    /(?:href|xlink:href)\s*=\s*(?:["']\s*)?(?:https?:|\/\/|data:text\/html)/i,
    /javascript:/i,
    /\burl\s*\(\s*(?:['"]\s*)?(?:https?:|\/\/|data:)/i,
    /<iframe|<embed|<object|<animate[^>]+attributeName\s*=\s*["']?href/i,
  ]
  return patterns.some(pattern => pattern.test(svgText))
}

/**
 * 导入前完整校验主题包清单。返回错误列表；非空时不得写入任何状态。
 */
export function validateThemePackage(manifest: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(manifest))
    return ['theme package must be an object']
  if (manifest.format !== 'panel-next-theme-package' || manifest.formatVersion !== 1) {
    errors.push('unsupported theme package format')
    return errors
  }
  const theme = manifest.theme
  if (!isRecord(theme)) {
    errors.push('theme package requires a theme object')
    return errors
  }

  // ---- 身份与元信息 ----
  if (typeof theme.id !== 'string' || theme.id.startsWith('core.'))
    errors.push('package theme id must not be empty or reserved')
  else if (!THEME_ID_PATTERN.test(theme.id))
    errors.push('package theme id violates the id pattern')
  if (!Number.isSafeInteger(theme.version) || (theme.version as number) < 1)
    errors.push('package theme version must be a positive integer')
  if (!isRecord(theme.meta) || typeof theme.meta.name !== 'string' || !(theme.meta.name as string).trim())
    errors.push('package theme meta.name is required')
  if (isRecord(theme.meta)) {
    const homepage = theme.meta.homepage
    if (homepage !== undefined) {
      try {
        const parsed = new URL(String(homepage))
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
          errors.push('meta.homepage must be an HTTP(S) link')
      }
      catch {
        errors.push('meta.homepage must be a valid URL')
      }
    }
    const preview = theme.meta.preview
    if (preview !== undefined && !isSafeAssetPath(String(preview)))
      errors.push('meta.preview must reference a packaged asset path')
  }
  if (theme.surfaces !== undefined) {
    if (!Array.isArray(theme.surfaces) || theme.surfaces.some(s => s !== 'web' && s !== 'extension'))
      errors.push('package surfaces are invalid')
  }

  // ---- Variant 声明 ----
  if (theme.variants !== undefined) {
    if (!isRecord(theme.variants)) {
      errors.push('package variants must be an object')
    }
    else {
      const variantError = validateVariantOverrides(theme.variants)
      if (variantError)
        errors.push(variantError)
    }
  }

  // ---- 图标映射：语义名必须受支持，值必须是本地雪碧图名或合法 Iconify 名称。
  // 禁止 assets 路径（含 preview/图片）作为 icons 值：数据主题包图标只允许
  // 宿主雪碧图名或明确允许的 Iconify 名称（危险 scheme 由 isIconifyName 拒绝）。
  const iconReferences: string[] = []
  if (theme.icons !== undefined) {
    if (!isRecord(theme.icons)) {
      errors.push('package icons must be an object')
    }
    else {
      for (const [key, value] of Object.entries(theme.icons)) {
        if (!THEME_ICON_NAMES.includes(key as never)) {
          errors.push(`unknown semantic icon "${key}"`)
          continue
        }
        if (typeof value !== 'string' || !value || value.length > 96) {
          errors.push(`icon "${key}" must be a local sprite name or a valid Iconify name`)
          continue
        }
        // 数据主题包（非可信源码）：只允许宿主雪碧图名或合法 Iconify 名；
        // 拒绝 assets/、绝对路径、../ 与任何危险 scheme（javascript:/data:/http: 等）。
        const assetLike = value.startsWith('assets/') || value.includes('/') || value.includes('..') || value.startsWith('/') || value.includes('\\')
        const iconValueValid = isLocalSpriteName(value) || isIconifyName(value)
        if (assetLike || !iconValueValid) {
          errors.push(`icon "${key}" must be a local sprite name or a valid Iconify name (assets paths are not allowed)`)
          continue
        }
        iconReferences.push(value)
      }
    }
  }

  // ---- Token 覆盖：必须能通过默认集补齐与严格 CSS 值解析（双模式） ----
  if (theme.tokens !== undefined) {
    if (!isRecord(theme.tokens) || !isRecord((theme.tokens as { light?: unknown }).light ?? {}) && !isRecord((theme.tokens as { dark?: unknown }).dark ?? {})) {
      errors.push('package tokens must contain light/dark override objects')
    }
    else {
      for (const mode of ['light', 'dark'] as const) {
        const overrides = (theme.tokens as Record<string, unknown>)[mode]
        if (overrides === undefined)
          continue
        if (!isRecord(overrides)) {
          errors.push(`token overrides for ${mode} must be an object`)
          continue
        }
        try {
          tokensToCssVariables(freezeTokens(completeTokens(mode === 'dark' ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS, overrides)))
        }
        catch (error) {
          errors.push(`${mode} token overrides are invalid: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  // ---- 配置默认值 ----
  if (theme.configDefaults !== undefined) {
    if (!isRecord(theme.configDefaults)) {
      errors.push('configDefaults must be an object')
    }
    else if (jsonSize(theme.configDefaults) > MAX_THEME_CONFIG_BYTES) {
      errors.push('configDefaults exceeds 32 KiB')
    }
  }

  // ---- 资源：路径/MIME/魔数/大小/内容安全 ----
  const assets = manifest.assets
  const assetPaths = new Set<string>()
  let totalBytes = 0
  if (assets !== undefined) {
    if (!isRecord(assets)) {
      errors.push('assets must be an object')
    }
    else {
      const entries = Object.entries(assets)
      if (entries.length > THEME_PACKAGE_MAX_ASSETS)
        errors.push(`assets exceed ${THEME_PACKAGE_MAX_ASSETS} entries`)
      for (const [path, asset] of entries) {
        if (!isSafeAssetPath(path)) {
          errors.push(`unsafe asset path "${path}"`)
          continue
        }
        assetPaths.add(path)
        if (!isRecord(asset) || typeof asset.mimeType !== 'string' || typeof asset.dataBase64 !== 'string') {
          errors.push(`asset "${path}" is malformed`)
          continue
        }
        const extension = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
        const expectedMime = EXTENSION_MIME[extension]
        if (!expectedMime || expectedMime !== asset.mimeType)
          errors.push(`asset "${path}" MIME ${asset.mimeType} does not match its extension`)
        if (!ASSET_MIME_WHITELIST.has(asset.mimeType))
          errors.push(`asset "${path}" has a non-whitelisted MIME type`)

        const decoded = decodeBase64Size(asset.dataBase64)
        if (!decoded) {
          errors.push(`asset "${path}" payload is not valid Base64`)
          continue
        }
        totalBytes += decoded.size
        if (decoded.size > THEME_PACKAGE_MAX_ASSET_BYTES)
          errors.push(`asset "${path}" exceeds 2 MiB`)
        if (!matchesMagic(asset.mimeType, decoded.bytes))
          errors.push(`asset "${path}" content does not match its MIME type`)
        if (asset.mimeType === 'image/svg+xml') {
          const text = new TextDecoder().decode(decoded.bytes)
          if (containsDangerousSvgContent(text))
            errors.push(`asset "${path}" contains executable or external SVG content`)
        }
      }
      const previewPath = String((theme.meta as Record<string, unknown>)?.preview ?? '')
      const previewAsset = previewPath ? (assets as Record<string, unknown>)[previewPath] : undefined
      if (previewAsset && isRecord(previewAsset)) {
        const decodedPreview = decodeBase64Size(previewAsset.dataBase64 as string)
        if (decodedPreview && decodedPreview.size > THEME_PACKAGE_MAX_PREVIEW_BYTES)
          errors.push('preview asset exceeds 1 MiB')
      }
      if (totalBytes > THEME_PACKAGE_MAX_TOTAL_BYTES)
        errors.push('assets exceed the 10 MiB package limit')
    }
  }
  else if ((theme.meta as Record<string, unknown>)?.preview !== undefined) {
    errors.push('meta.preview references an asset but the package defines no assets')
  }

  // ---- 引用完整性：预览与图标指向的资源必须真实存在 ----
  const previewRef = String((theme.meta as Record<string, unknown>)?.preview ?? '')
  if (previewRef && assets && isRecord(assets) && !assetPaths.has(previewRef))
    errors.push(`meta.preview references missing asset "${previewRef}"`)
  for (const ref of iconReferences) {
    if (ref.includes(':'))
      continue // Iconify 名称，非资源路径
    // 仅当值形如资源文件（带白名单扩展名）时才要求资产存在；
    // 其余视为应用内置雪碧图名。
    const looksLikeAsset = /\.(?:png|jpe?g|webp|gif|svg|woff2?)$/i.test(ref)
    if (looksLikeAsset && assets && isRecord(assets) && !assetPaths.has(ref))
      errors.push(`icon references missing asset "${ref}"`)
  }

  return errors
}

/** 导入成功后计算包摘要（SHA-256，十六进制）。 */
export function computePackageDigest(manifest: unknown): string {
  return SHA256(JSON.stringify(manifest)).toString()
}

export interface ImportedThemePackage {
  definition: ThemeDefinition
  digest: string
}

/**
 * 将通过校验的清单转换为可注册的纯数据 ThemeDefinition。
 * 数据化包绝不携带 resolveTokens/component 等代码字段；
 * 图标映射保持名称引用（本地雪碧图名或 Iconify 名），不做资源 URL 改写。
 */
export function themePackageToDefinition(manifest: ThemePackageManifestV1): ThemeDefinition {
  const configDefaults = isRecord(manifest.theme.configDefaults) ? manifest.theme.configDefaults : {}
  const icons = manifest.theme.icons as Partial<ThemeIconSet> | undefined
  const definition: ThemeDefinition = {
    id: manifest.theme.id,
    version: manifest.theme.version,
    meta: manifest.theme.meta as ThemeDefinition['meta'],
    surfaces: manifest.theme.surfaces as ThemeDefinition['surfaces'],
    variants: manifest.theme.variants,
    icons,
    tokens: manifest.theme.tokens as ThemeDefinition['tokens'],
    configSchema: {
      parse: value => (isRecord(value) ? cloneJson(value) : cloneJson(configDefaults)),
      fields: {},
    },
    defaultConfig: () => cloneJson(configDefaults),
  }
  delete (definition as Partial<ThemeDefinition>).resolveTokens
  // component 是【保留且未实现】的 @deprecated 字段：外部数据主题包一律丢弃，
  // 绝不让它进入渲染路径（ThemeProvider 不渲染它）。见 src/themes/types.ts。
  // 若启用必须先实现「受控渲染入口 + 错误边界」，且仅限随应用打包审核的信任代码。
  delete (definition as Partial<ThemeDefinition>).component
  return definition
}

/** 校验一个待保存的普通选择（供导入器复用出口规则）。 */
export function validateImportedSelection(selection: unknown): string | null {
  return validateThemeWireSelection(selection)
    ?? (String((selection as ThemeSelection)?.themeId) === DEFAULT_THEME_ID ? 'cannot override the built-in default theme via import' : null)
}
