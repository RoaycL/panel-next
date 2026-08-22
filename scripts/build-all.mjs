import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const node = process.execPath
const vueTscBin = path.resolve('node_modules/vue-tsc/bin/vue-tsc.js')
const viteBin = path.resolve('node_modules/vite/bin/vite.js')

function runStep(name, cmd, args) {
  console.log(`\n=== [build:all] Running Step: ${name} ===`)
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env },
  })
  if (result.error) {
    console.error(`[build:all] Step ${name} failed to launch:`, result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[build:all] Step ${name} exited with code ${result.status}`)
    process.exit(result.status ?? 1)
  }
  console.log(`=== [build:all] Step: ${name} Completed Successfully ===\n`)
}

// 1. Validation scripts
runStep('validate:version', node, [path.resolve('scripts/validate-version.mjs')])
runStep('validate:repository', node, [path.resolve('scripts/validate-repository-hygiene.mjs')])
runStep('validate:architecture', node, [path.resolve('scripts/validate-architecture.mjs')])
runStep('validate:bootstrap-cache', node, [path.resolve('scripts/validate-bootstrap-snapshot.mjs')])
runStep('validate:dashboard-core', node, [path.resolve('scripts/validate-dashboard-core.mjs')])
runStep('validate:runtime-navigation', node, [path.resolve('scripts/validate-runtime-navigation.mjs')])
runStep('validate:lazy-management', node, [path.resolve('scripts/validate-lazy-management.mjs')])
runStep('validate:status-ui', node, [path.resolve('scripts/validate-status-ui.mjs')])
runStep('validate:responsive-ui', node, [path.resolve('scripts/validate-responsive-ui.mjs')])
runStep('validate:widget-registry', node, [path.resolve('scripts/validate-widget-registry.mjs')])
runStep('validate:offline-sync', node, [path.resolve('scripts/validate-offline-sync.mjs')])

// 2. Type check (local binary, offline safe)
runStep('type-check', node, [vueTscBin, '--noEmit'])

// 3. Web build (local binary, offline safe)
runStep('build:web', node, [viteBin, 'build'])

// 4. Extension build (local binary, offline safe)
runStep('build:extension:validate-pre', node, [path.resolve('scripts/validate-version.mjs')])
runStep('build:extension:vite', node, [viteBin, 'build', '--mode', 'extension'])
runStep('build:extension:validate-post', node, [path.resolve('scripts/validate-extension.mjs')])

console.log('\n🎉 ALL build:all steps completed successfully!\n')
