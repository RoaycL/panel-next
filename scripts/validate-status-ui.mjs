import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync(new URL('../src/views/home/index.vue', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const themeHook = fs.readFileSync(new URL('../src/hooks/useTheme.ts', import.meta.url), 'utf8')
const naiveProvider = fs.readFileSync(new URL('../src/components/common/NaiveProvider/index.vue', import.meta.url), 'utf8')
const userHub = fs.readFileSync(new URL('../src/views/extension/components/UserHubModal.vue', import.meta.url), 'utf8')
const extensionView = fs.readFileSync(new URL('../src/views/extension/index.vue', import.meta.url), 'utf8')
const extensionRuntime = fs.readFileSync(new URL('../src/runtime/extension.ts', import.meta.url), 'utf8')
const extensionTheme = fs.readFileSync(new URL('../src/theme/extensionTheme.ts', import.meta.url), 'utf8')
const sanitizer = fs.readFileSync(new URL('../src/utils/sanitizeHtml.ts', import.meta.url), 'utf8')
for (const required of [
  'runtimeLabel', 'networkLabel', 'sessionLabel', 'sessionTitle',
  'runtime-status-bar', 'browserOnline', 'extensionSyncLabel',
  "window.addEventListener('online', handleBrowserOnline)",
  "window.addEventListener('offline', handleBrowserOffline)",
]) {
  assert.ok(home.includes(required), `status UI is missing ${required}`)
}
assert.match(home, /v-if="layout === 'extension'"[\s\S]*refreshExtensionBootstrap/)
assert.match(home, /authStore\.visitMode === VisitMode\.VISIT_MODE_LOGIN && authStore\.authMode === 'device'/)
assert.match(home, /if \(authStore\.authMode !== 'device'\)\s+return\s+const bootstrap = await getBootstrap\(\)/)

assert.match(app, /createExtensionThemeOverrides\(providerView\.value\.loadResult\.resolved\.tokens\)/)
assert.match(app, /getThemePreview\(\) \?\? effectiveThemeSelection\.value/)
assert.match(app, /classList\.toggle\('dark', dark\)/)
assert.match(extensionTheme, /extensionDarkThemeOverrides/)
assert.match(extensionTheme, /extensionLightThemeOverrides/)
assert.match(extensionTheme, /function createExtensionThemeOverrides\(tokens/)
assert.match(extensionTheme, /tokens\.notification\.background/)
assert.doesNotMatch(themeHook, /runtime\.kind === 'extension'/, 'extension must honor light, dark and auto modes')
assert.match(naiveProvider, /NNotificationProvider placement="top-right"/)
assert.match(naiveProvider, /NMessageProvider placement="top-right"/)
assert.ok(!userHub.includes('NConfigProvider'), 'user center must inherit the root extension theme')
assert.match(userHub, /class="user-hub-modal"/)
assert.ok(!extensionView.includes(':theme="darkTheme"'), 'extension modals must inherit the root extension theme')
assert.match(extensionView, /class="wallpaper-manager-modal extension-surface-modal"/)
assert.ok(!extensionView.includes('<header class="top-nav-bar">'), 'removed extension top-right controls must not return')
assert.match(extensionView, /runtime\.openUrl\(card\.lanUrl, 'tab'\)/)
assert.match(extensionView, /window\.addEventListener\('offline', handleBrowserOffline\)/)
assert.match(extensionView, /window\.removeEventListener\('offline', handleBrowserOffline\)/)
assert.match(extensionView, /removeSyncConflictListener\?\.\(\)/)
assert.match(extensionView, /runtime\.storage\.subscribe\?\.\(handleExternalStorageChange\)/)
assert.match(extensionRuntime, /consumeLocalMutation\(key, change\.newValue\)/)
assert.match(extensionRuntime, /subscribe\(listener: \(change: StorageChangeEvent\) => void\)/)
assert.match(home, /v-html="safeFooterHtml"/)
assert.ok(!home.includes('v-html="panelState.panelConfig.footerHtml"'), 'footer HTML must not be rendered without sanitizing')
assert.match(sanitizer, /const ALLOWED_TAGS = new Set/)
assert.match(sanitizer, /element\.removeAttribute\(attribute\.name\)/)
assert.match(sanitizer, /noopener noreferrer/)

console.log('Validated status UI, extension theming, lifecycle cleanup, safe footer rendering, and cross-tab storage updates')
