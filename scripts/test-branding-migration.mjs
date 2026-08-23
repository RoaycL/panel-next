import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

/** 品牌迁移单元测试：历史 Sun-Panel 页脚替换为 Panel Next 默认页脚。 */

const source = fs.readFileSync(new URL('../src/utils/branding.ts', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
const footer = fs.readFileSync(new URL('../src/utils/defaultFooter.ts', import.meta.url), 'utf8')

const combined = `${footer}\n${source}`
const transpiled = ts.transpileModule(combined, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'branding.ts',
})
const mod = await import(`data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`)
const { isLegacyBrandedFooter, migrateLegacyFooterHtml } = mod

// 原项目仓库链接 → 替换
assert.equal(isLegacyBrandedFooter('<div>Powered By <a href="https://github.com/hslr-s/sun-panel" target="_blank">Sun-Panel</a></div>'), true)
// Powered By Sun-Panel 文案（无链接）→ 替换
assert.equal(isLegacyBrandedFooter('<span>Powered By Sun-Panel</span>'), true)
assert.equal(isLegacyBrandedFooter('powered by sunpanel'), true)
// 大小写不敏感
assert.equal(isLegacyBrandedFooter('POWERED BY SUN-PANEL'), true)

// Panel Next 默认页脚 / 用户自定义内容 → 不动
const panelNextFooter = '<div>Powered By <a href="https://github.com/RoaycL/panel-next" target="_blank">Panel Next</a></div>'
assert.equal(isLegacyBrandedFooter(panelNextFooter), false)
assert.equal(isLegacyBrandedFooter(undefined), false)
assert.equal(isLegacyBrandedFooter(''), false)

const config = { footerHtml: '<div>Powered By <a href="https://github.com/hslr-s/sun-panel">Sun-Panel</a></div>' }
const migrated = migrateLegacyFooterHtml(config)
assert.match(migrated.footerHtml, /RoaycL\/panel-next/)
assert.doesNotMatch(migrated.footerHtml, /hslr-s\/sun-panel/i)
// 其余字段原样保留
assert.equal(Object.keys(migrated).includes('footerHtml'), true)

// 用户自定义页脚不被改写
const custom = { footerHtml: '<div>我的自定义备案号 京ICPxxxx</div>' }
assert.equal(migrateLegacyFooterHtml(custom), custom, 'custom footer returned untouched (same reference)')

// 默认页脚本身不含旧品牌
assert.doesNotMatch(mod.defaultFooterHtml, /sun-panel/i)

console.log('✅ Branding migration tests passed: legacy Sun-Panel footers are replaced; custom footers preserved.')
