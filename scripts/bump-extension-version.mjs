import fs from 'node:fs'
import path from 'node:path'

// 让扩展 manifest 与 package.json 版本跟随 service/assets/version 单一版本源。
// 构建扩展不递增版本；正式发版时统一修改 service/assets/version。
const versionFile = path.resolve('service/assets/version')
const packageFile = path.resolve('package.json')
const manifestFile = path.resolve('extension/manifest.json')

const source = fs.readFileSync(versionFile, 'utf8').trim()
const [rawCode, currentVersion] = source.split('|')
const parts = currentVersion?.split('.')

if (!/^\d+$/.test(rawCode) || !parts || parts.length !== 3 || parts.some(part => !Number.isInteger(Number(part)) || Number(part) < 0))
  throw new Error(`Invalid version source: ${source}`)

const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))

packageJson.version = currentVersion
manifest.version = currentVersion

fs.writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`)
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Extension version synced to ${currentVersion}`)
