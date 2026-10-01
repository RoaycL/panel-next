import type { WidgetSize } from '@/widgets/types'

/** Remote plugins are declarative data, never downloaded JavaScript or HTML. */
export interface PluginPackage {
  format: 'panel-next-widget-package'
  formatVersion: 1
  plugin: {
    id: string
    version: number
    name: string
    author?: string
    description?: string
    size: WidgetSize
    blocks: Array<{ kind: 'text' | 'metric' | 'link'; label: string; value?: string; url?: string }>
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key)))
    throw new Error('组件包包含不支持的字段；不允许脚本、HTML 或 CSS')
}

function text(value: unknown, maximum: number, required = true): value is string {
  return typeof value === 'string' && (!required || !!value.trim()) && value.length <= maximum
}

export function parsePluginPackage(value: unknown): PluginPackage {
  if (!record(value) || value.format !== 'panel-next-widget-package' || value.formatVersion !== 1 || !record(value.plugin))
    throw new Error('不是受支持的小组件包（JSON v1）')
  keys(value, ['format', 'formatVersion', 'plugin'])
  const p = value.plugin
  keys(p, ['id', 'version', 'name', 'author', 'description', 'size', 'blocks'])
  if (!text(p.id, 64) || !/^[a-z0-9][a-z0-9.-]*$/.test(p.id) || p.id.startsWith('core.')
    || !Number.isSafeInteger(p.version) || Number(p.version) < 1 || Number(p.version) > 1000
    || !text(p.name, 80) || (p.author !== undefined && !text(p.author, 100, false))
    || (p.description !== undefined && !text(p.description, 300, false)))
    throw new Error('组件标识、版本或名称无效')
  if (!record(p.size))
    throw new Error('缺少组件尺寸')
  keys(p.size, ['columns', 'rows'])
  if (!Number.isInteger(p.size.columns) || Number(p.size.columns) < 1 || Number(p.size.columns) > 4
    || !Number.isInteger(p.size.rows) || Number(p.size.rows) < 1 || Number(p.size.rows) > 2)
    throw new Error('组件尺寸必须在 1×1 至 4×2 之间')
  if (!Array.isArray(p.blocks) || !p.blocks.length || p.blocks.length > 20)
    throw new Error('组件内容数量必须为 1–20')
  for (const block of p.blocks) {
    if (!record(block))
      throw new Error('组件内容无效')
    keys(block, ['kind', 'label', 'value', 'url'])
    if (!['text', 'metric', 'link'].includes(String(block.kind)) || !text(block.label, 160)
      || (block.value !== undefined && !text(block.value, 600, false)))
      throw new Error('组件内容无效')
    if (block.kind === 'link') {
      if (!text(block.url, 2048))
        throw new Error('链接地址无效')
      const url = new URL(block.url)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('只支持无凭据的 HTTP(S) 链接')
    }
    else if (block.url !== undefined) {
      throw new Error('只有链接内容可声明 URL')
    }
  }
  return JSON.parse(JSON.stringify(value)) as PluginPackage
}
