import fs from 'node:fs'
import path from 'node:path'

const versionFile = path.resolve('service/assets/version')
const packageFile = path.resolve('package.json')
const manifestFile = path.resolve('extension/manifest.json')

const source = fs.readFileSync(versionFile, 'utf8').trim()
const [rawCode, currentVersion] = source.split('|')
const parts = currentVersion?.split('.').map(Number)

if (!/^\d+$/.test(rawCode) || !parts || parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0))
  throw new Error(`Invalid version source: ${source}`)

const nextVersion = `${parts[0]}.${parts[1] + 1}.0`
const nextCode = Number(rawCode) + 1
const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))

packageJson.version = nextVersion
manifest.version = nextVersion

fs.writeFileSync(versionFile, `${nextCode}|${nextVersion}\n`)
fs.writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`)
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Extension version bumped: ${currentVersion} -> ${nextVersion}`)

