import fs from 'node:fs'
import path from 'node:path'

const policy = JSON.parse(fs.readFileSync(path.resolve('version-policy.json'), 'utf8'))
const source = fs.readFileSync(path.resolve(policy.source), 'utf8').trim()
const [rawCode, version] = source.split('|')
const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.resolve('extension/manifest.json'), 'utf8'))
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const match = versionPattern.exec(version || '')

if (!/^\d+$/.test(rawCode || '') || Number(rawCode) < 1)
  throw new Error(`Invalid version code in ${policy.source}: ${rawCode || '(empty)'}`)
if (!match)
  throw new Error(`Version must contain three numeric components without leading zeroes: ${version || '(empty)'}`)
if (policy.stage !== 'testing' || policy.series !== '0.0' || policy.firstVersion !== '0.0.1')
  throw new Error('Testing version policy was changed. Review version-policy.json explicitly before packaging.')
if (`${match[1]}.${match[2]}` !== policy.series || Number(match[3]) < 1)
  throw new Error(`Testing packages must use ${policy.series}.x starting at ${policy.firstVersion}; received ${version}.`)
if (packageJson.version !== version || manifest.version !== version)
  throw new Error(`Version mismatch: source=${version}, package=${packageJson.version}, manifest=${manifest.version}`)
if (manifest.version_name !== `${version} ${policy.label}`)
  throw new Error(`Manifest version_name must identify the testing package as "${version} ${policy.label}".`)

console.log(`Validated ${policy.label} version ${version} (code ${rawCode}, policy ${policy.series}.x).`)
