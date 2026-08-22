import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { executePackageExtensionTransaction } from './package-extension-transactional.mjs'

// Helper to suppress expected console.error and console.warn in tests
async function withMutedConsole(fn) {
  const originalError = console.error
  const originalWarn = console.warn
  console.error = () => {}
  console.warn = () => {}
  try {
    return await fn()
  }
  finally {
    console.error = originalError
    console.warn = originalWarn
  }
}

console.log('--- Running Extension Package Transactional Unit Tests ---')

const versionFilePath = path.resolve('service/assets/version')
const packageFilePath = path.resolve('package.json')
const manifestFilePath = path.resolve('extension/manifest.json')
const artifactDirPath = path.resolve('artifacts')

const initialVersionContent = fs.readFileSync(versionFilePath, 'utf8')
const initialPackageContent = fs.readFileSync(packageFilePath, 'utf8')
const initialManifestContent = fs.readFileSync(manifestFilePath, 'utf8')
const initialTemporaryBuilds = fs.existsSync(path.resolve('dist'))
  ? fs.readdirSync(path.resolve('dist')).filter(name => name.startsWith('.extension-package-')).sort()
  : []

// 1. Dry run pre-check succeeds and predicts correct next version and artifact name
const dryRunResult = executePackageExtensionTransaction({ dryRun: true })

assert.equal(dryRunResult.success, true)
assert.equal(typeof dryRunResult.currentVersion, 'string')
assert.equal(typeof dryRunResult.nextVersion, 'string')
assert.equal(dryRunResult.nextCode, Number(initialVersionContent.trim().split('|')[0]) + 1)
assert.equal(dryRunResult.archiveName, `panel-next-extension-v${dryRunResult.nextVersion}.zip`)

// Verify repository files were NOT modified during dry-run
assert.equal(fs.readFileSync(versionFilePath, 'utf8'), initialVersionContent)
assert.equal(fs.readFileSync(packageFilePath, 'utf8'), initialPackageContent)
assert.equal(fs.readFileSync(manifestFilePath, 'utf8'), initialManifestContent)

console.log(`Dry run verified: ${dryRunResult.currentVersion} -> ${dryRunResult.nextVersion} (artifact: ${dryRunResult.archiveName})`)

// 2. A preflight failure happens before any version file is touched.
await withMutedConsole(async () => {
  await assert.rejects(
    async () => executePackageExtensionTransaction({
      customRunner: step => ({ status: step === 'preflight' ? 1 : 0 }),
    }),
    err => /preflight build failed/i.test(err.message),
  )
})
assert.equal(fs.readFileSync(versionFilePath, 'utf8'), initialVersionContent)
assert.equal(fs.readFileSync(packageFilePath, 'utf8'), initialPackageContent)
assert.equal(fs.readFileSync(manifestFilePath, 'utf8'), initialManifestContent)

// 3. Simulated failure at validate-version phase
await withMutedConsole(async () => {
  await assert.rejects(
    async () => executePackageExtensionTransaction({
      customRunner: (step) => {
        if (step === 'validate-version')
          return { status: 1 }
        return { status: 0 }
      },
    }),
    err => /validate-version failed/i.test(err.message),
  )
})

assert.equal(fs.readFileSync(versionFilePath, 'utf8'), initialVersionContent)
assert.equal(fs.readFileSync(packageFilePath, 'utf8'), initialPackageContent)
assert.equal(fs.readFileSync(manifestFilePath, 'utf8'), initialManifestContent)
assert.equal(fs.existsSync(path.join(artifactDirPath, dryRunResult.archiveName)), false)

// 4. Simulated failure at build-extension phase
await withMutedConsole(async () => {
  await assert.rejects(
    async () => executePackageExtensionTransaction({
      customRunner: (step) => {
        if (step === 'build-extension')
          return { status: 1 }
        return { status: 0 }
      },
    }),
    err => /vite build --mode extension failed/i.test(err.message),
  )
})

assert.equal(fs.readFileSync(versionFilePath, 'utf8'), initialVersionContent)
assert.equal(fs.readFileSync(packageFilePath, 'utf8'), initialPackageContent)
assert.equal(fs.readFileSync(manifestFilePath, 'utf8'), initialManifestContent)
assert.equal(fs.existsSync(path.join(artifactDirPath, dryRunResult.archiveName)), false)

// 5. Simulated failure at validate-extension phase
await withMutedConsole(async () => {
  await assert.rejects(
    async () => executePackageExtensionTransaction({
      customRunner: (step) => {
        if (step === 'validate-extension')
          return { status: 1 }
        return { status: 0 }
      },
    }),
    err => /validate-extension failed/i.test(err.message),
  )
})

assert.equal(fs.readFileSync(versionFilePath, 'utf8'), initialVersionContent)
assert.equal(fs.readFileSync(packageFilePath, 'utf8'), initialPackageContent)
assert.equal(fs.readFileSync(manifestFilePath, 'utf8'), initialManifestContent)
assert.equal(fs.existsSync(path.join(artifactDirPath, dryRunResult.archiveName)), false)

// 6. Simulated failure at package-extension zip phase
await withMutedConsole(async () => {
  await assert.rejects(
    async () => executePackageExtensionTransaction({
      customRunner: (step) => {
        if (step === 'package-extension')
          return { status: 1 }
        return { status: 0 }
      },
    }),
    err => /package-extension zip step failed/i.test(err.message),
  )
})

assert.equal(fs.readFileSync(versionFilePath, 'utf8'), initialVersionContent)
assert.equal(fs.readFileSync(packageFilePath, 'utf8'), initialPackageContent)
assert.equal(fs.readFileSync(manifestFilePath, 'utf8'), initialManifestContent)
assert.equal(fs.existsSync(path.join(artifactDirPath, dryRunResult.archiveName)), false)
const finalTemporaryBuilds = fs.existsSync(path.resolve('dist'))
  ? fs.readdirSync(path.resolve('dist')).filter(name => name.startsWith('.extension-package-')).sort()
  : []
assert.deepEqual(finalTemporaryBuilds, initialTemporaryBuilds)

console.log('All simulated failure rollback phases verified.')
console.log('✅ ALL Package Transaction Unit Tests Passed!')
