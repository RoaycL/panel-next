import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export function executePackageExtensionTransaction({ dryRun = false, customRunner = null } = {}) {
  const policy = JSON.parse(fs.readFileSync(path.resolve('version-policy.json'), 'utf8'))
  const versionFile = path.resolve(policy.source)
  const packageFile = path.resolve('package.json')
  const manifestFile = path.resolve('extension/manifest.json')
  const artifactRoot = path.resolve('artifacts')

  const originalVersionSource = fs.readFileSync(versionFile, 'utf8')
  const originalPackageJson = fs.readFileSync(packageFile, 'utf8')
  const originalManifest = fs.readFileSync(manifestFile, 'utf8')

  const source = originalVersionSource.trim()
  const [rawCode, currentVersion] = source.split('|')
  const parts = currentVersion?.split('.')

  if (!/^\d+$/.test(rawCode) || !parts || parts.length !== 3 || parts.some(part => !Number.isInteger(Number(part)) || Number(part) < 0))
    throw new Error(`Invalid version source: ${source}`)
  if (`${parts[0]}.${parts[1]}` !== policy.series || policy.packageIncrement !== 'patch')
    throw new Error(`Version ${currentVersion} does not satisfy the ${policy.stage} ${policy.series}.x packaging policy.`)

  const nextVersion = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`
  const nextCode = Number(rawCode) + 1
  if (nextVersion.localeCompare(policy.firstVersion, undefined, { numeric: true }) < 0)
    throw new Error(`The first testing package must be ${policy.firstVersion}.`)

  const archiveName = `panel-next-extension-v${nextVersion}.zip`
  const archivePath = path.join(artifactRoot, archiveName)

  if (fs.existsSync(archivePath) || fs.existsSync(`${archivePath}.sha256`))
    throw new Error(`Refusing to overwrite an existing package for version ${nextVersion}. Increment the version first.`)

  if (dryRun) {
    return {
      success: true,
      currentVersion,
      nextVersion,
      nextCode,
      archiveName,
    }
  }

  // Transaction start: update files
  const parsedPackageJson = JSON.parse(originalPackageJson)
  const parsedManifest = JSON.parse(originalManifest)

  parsedPackageJson.version = nextVersion
  parsedManifest.version = nextVersion
  parsedManifest.version_name = `${nextVersion} ${policy.label}`

  const node = process.execPath
  const viteBin = path.resolve('node_modules/vite/bin/vite.js')
  const temporaryBuildRoot = path.resolve('dist', `.extension-package-${process.pid}-${Date.now()}`)

  const defaultRunner = (step, cmd, args) => {
    return spawnSync(cmd, args, { stdio: 'inherit' })
  }
  const runner = customRunner ?? defaultRunner

  // Run the complete non-mutating validation/build pipeline before touching
  // version files. A broken working tree must never be advanced to the next
  // package number.
  const preflight = runner('preflight', node, [path.resolve('scripts/build-all.mjs')])
  if (preflight.status !== 0)
    throw new Error('preflight build failed before packaging; version files were not changed')

  try {
    fs.writeFileSync(versionFile, `${nextCode}|${nextVersion}\n`)
    fs.writeFileSync(packageFile, `${JSON.stringify(parsedPackageJson, null, 2)}\n`)
    fs.writeFileSync(manifestFile, `${JSON.stringify(parsedManifest, null, 2)}\n`)

    // 1. Validate version
    let res = runner('validate-version', node, [path.resolve('scripts/validate-version.mjs')])
    if (res.status !== 0)
      throw new Error('validate-version failed during packaging')

    // 2. Build extension (offline safe with local vite binary)
    res = runner('build-extension', node, [
      viteBin,
      'build',
      '--mode',
      'extension',
      '--outDir',
      temporaryBuildRoot,
      '--emptyOutDir',
    ])
    if (res.status !== 0)
      throw new Error('vite build --mode extension failed during packaging')

    // 3. Validate extension build
    res = runner('validate-extension', node, [path.resolve('scripts/validate-extension.mjs'), temporaryBuildRoot])
    if (res.status !== 0)
      throw new Error('validate-extension failed during packaging')

    // 4. Package extension zip (atomic with temporary files)
    res = runner('package-extension', node, [path.resolve('scripts/package-extension.mjs'), temporaryBuildRoot])
    if (res.status !== 0)
      throw new Error('package-extension zip step failed')

    fs.rmSync(temporaryBuildRoot, { recursive: true, force: true })
    return {
      success: true,
      currentVersion,
      nextVersion,
      nextCode,
      archiveName,
    }
  }
  catch (error) {
    console.error('Packaging failed! Rolling back version files and cleaning artifacts...', error)
    fs.writeFileSync(versionFile, originalVersionSource)
    fs.writeFileSync(packageFile, originalPackageJson)
    fs.writeFileSync(manifestFile, originalManifest)
    fs.rmSync(temporaryBuildRoot, { recursive: true, force: true })

    // 清理可能产生的未完成产物
    if (fs.existsSync(archivePath))
      fs.unlinkSync(archivePath)
    if (fs.existsSync(`${archivePath}.sha256`))
      fs.unlinkSync(`${archivePath}.sha256`)

    if (fs.existsSync(artifactRoot)) {
      const remainingArtifacts = fs.readdirSync(artifactRoot)
      for (const item of remainingArtifacts) {
        if (item.includes(nextVersion) && item.includes('.tmp.')) {
          try {
            fs.unlinkSync(path.join(artifactRoot, item))
          }
          catch {}
        }
      }
    }

    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/package-extension-transactional.mjs')) {
  executePackageExtensionTransaction()
}
