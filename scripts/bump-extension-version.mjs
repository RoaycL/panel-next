import fs from 'node:fs'
import path from 'node:path'

// Packaging advances the patch version once. Ordinary compilation stays
// reproducible and never mutates source-controlled version files.
const policy = JSON.parse(fs.readFileSync(path.resolve('version-policy.json'), 'utf8'))
const versionFile = path.resolve(policy.source)
const packageFile = path.resolve('package.json')
const manifestFile = path.resolve('extension/manifest.json')

const source = fs.readFileSync(versionFile, 'utf8').trim()
const [rawCode, currentVersion] = source.split('|')
const parts = currentVersion?.split('.')

if (!/^\d+$/.test(rawCode) || !parts || parts.length !== 3 || parts.some(part => !Number.isInteger(Number(part)) || Number(part) < 0))
  throw new Error(`Invalid version source: ${source}`)
if (`${parts[0]}.${parts[1]}` !== policy.series || policy.packageIncrement !== 'patch')
  throw new Error(`Version ${currentVersion} does not satisfy the ${policy.stage} ${policy.series}.x packaging policy.`)

const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
const nextVersion = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`
const nextCode = Number(rawCode) + 1
if (nextVersion.localeCompare(policy.firstVersion, undefined, { numeric: true }) < 0)
  throw new Error(`The first testing package must be ${policy.firstVersion}.`)

packageJson.version = nextVersion
manifest.version = nextVersion
manifest.version_name = `${nextVersion} ${policy.label}`

fs.writeFileSync(versionFile, `${nextCode}|${nextVersion}\n`)
fs.writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`)
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`${policy.label} package version bumped from ${currentVersion} to ${nextVersion}`)
