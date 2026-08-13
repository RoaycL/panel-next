import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync(new URL('../src/views/home/index.vue', import.meta.url), 'utf8')
for (const required of [
  'runtimeLabel', 'networkLabel', 'sessionLabel', 'sessionTitle',
  'runtime-status-bar', 'browserOnline', 'extensionSyncLabel',
  "window.addEventListener('online', handleBrowserOnline)",
  "window.addEventListener('offline', handleBrowserOffline)",
]) {
  assert.ok(home.includes(required), `status UI is missing ${required}`)
}
assert.match(home, /v-if="layout === 'extension'"[\s\S]*refreshExtensionBootstrap/)

console.log('Validated runtime, network, sync, and session status UI')
