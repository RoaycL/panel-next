import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync(new URL('../src/views/home/index.vue', import.meta.url), 'utf8')
const starter = fs.readFileSync(new URL('../src/views/home/components/AppStarter/index.vue', import.meta.url), 'utf8')
const theme = fs.readFileSync(new URL('../src/hooks/useTheme.ts', import.meta.url), 'utf8')
const login = fs.readFileSync(new URL('../src/views/login/index.vue', import.meta.url), 'utf8')
const editItem = fs.readFileSync(new URL('../src/views/home/components/EditItem/index.vue', import.meta.url), 'utf8')
const roundCardModal = fs.readFileSync(new URL('../src/components/common/RoundCardModal/index.vue', import.meta.url), 'utf8')
const extension = fs.readFileSync(new URL('../src/views/extension/index.vue', import.meta.url), 'utf8')
const extensionSettings = fs.readFileSync(new URL('../src/views/extension/components/UserHubModal.vue', import.meta.url), 'utf8')
const userCenter = fs.readFileSync(new URL('../src/components/apps/UserInfo/index.vue', import.meta.url), 'utf8')
const userSessions = fs.readFileSync(new URL('../src/components/apps/UserSessions/index.vue', import.meta.url), 'utf8')
const extensionPreferences = fs.readFileSync(new URL('../src/runtime/extensionAppearance.ts', import.meta.url), 'utf8')
const routerPermission = fs.readFileSync(new URL('../src/router/permission.ts', import.meta.url), 'utf8')
const localControlIcons = new Set(fs.readdirSync(new URL('../src/assets/svg-icons/', import.meta.url)).map(name => name.replace(/\.svg$/, '')))
const extensionTemplate = extension.slice(extension.indexOf('<template>'))

function bundledIconNames(source) {
  return [...source.matchAll(/['"]((?:material-symbols|mingcute|mdi|ri|simple-icons)[:\-][a-z0-9-]+)['"]/gi)]
    .map(match => match[1].replaceAll(':', '-'))
}

for (const rule of [
  /\.sun-main\s*\{[^}]*overflow:\s*hidden/,
  /\.runtime-status-bar\s*\{[^}]*flex-wrap:\s*wrap/,
  /@media \(max-width: 640px\)/,
  /font-size:\s*clamp\(/,
  /max-width:\s*calc\(100% - 20px\)/,
]) {
  assert.match(home, rule)
}
assert.match(starter, /isSmallScreen/)
assert.match(starter, /screenWidth\.value < 768/)
assert.match(starter, /dark:/)
assert.match(theme, /document\.documentElement\.classList\.(?:add|remove)\('dark'\)/)
assert.match(theme, /useOsTheme/)
assert.doesNotMatch(theme, /runtime\.kind === 'extension'/)
assert.match(home, /<ThemeIcon/g)
assert.match(login, /width:\s*min\(440px, 100%\)/)
assert.ok(!/min-width:\s*400px/.test(login), 'login card must not overflow narrow extension windows')
assert.match(editItem, /width: min\(620px, calc\(100vw - 24px\)\)/)
assert.ok(!roundCardModal.includes(':style="$parent"'), 'shared modal must not bind a component proxy as inline CSS')
assert.match(roundCardModal, /maxWidth: 'calc\(100vw - 24px\)'/)
assert.match(extension, /<ItemIcon :item-icon="item\.card\.icon" :size="64"/)
assert.match(extension, /\.extension-dashboard-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(12, minmax\(0, 1fr\)\)[\s\S]*?grid-auto-rows:\s*var\(--widget-grid-row-height\)[\s\S]*?gap:\s*12px/)
assert.match(extension, /v-model="activeCanvasItems"/)
assert.match(extension, /item\.kind === 'widget' \? extensionWidgetCellStyle\(item\.group\) : bookmarkCardStyle\(item\.card\)/)
assert.match(extension, /watch\(readyPageLayoutKey/)
assert.match(extension, /\.speed-card\s*\{[^}]*background:\s*transparent/)
assert.match(extension, /@media \(max-width: 720px\)[\s\S]*?\.extension-dashboard-grid\s*\{[^}]*min-width:\s*840px/)
assert.match(extension, /@keydown\.enter\.prevent="item\.kind === 'bookmark' && handleCardClick\(item\.card\)"/)
assert.ok(!extension.includes('class="card-desc"'), 'extension bookmark icons must not render the old card description')
assert.ok(!extension.includes('<header class="top-nav-bar">'), 'extension must not render the removed top-right toolbar')
assert.match(extension, /\.card-icon-box\s*\{[^}]*border:\s*0/)
assert.match(extension, /sidebarPosition === 'right'/)
assert.match(extension, /sidebarAutoHide\.value \? 3000 : 220/)
assert.match(extension, /v-model:sidebar-position="sidebarPosition"/)
assert.match(extension, /class="rail-icon"/)
assert.match(extension, /class="rail-groups"/)
assert.match(extension, /v-for="\(group, index\) in groupTabs"/)
assert.match(extension, /class="rail-button rail-settings"/)
assert.match(extension, /class="rail-avatar-status"/)
assert.match(extension, /extensionSyncPresentation/)
assert.match(extension, /class="extension-edit-mode-copy"/)
assert.match(extension, /\.side-rail\s*\{[\s\S]*?inset:\s*12px auto 12px 12px;[\s\S]*?border-radius:\s*20px;/)
assert.match(extension, /\.extension-widget-toolbar\s*\{[\s\S]*?position:\s*sticky;/)
assert.doesNotMatch(extension, /<aside[\s\S]*class="function-panel"/, 'extension sidebar must not duplicate groups in a flyout panel')
assert.match(extension, /\.extension-widget-toolbar\s*\{[^}]*position:\s*absolute/)
assert.match(extension, /\.extension-widget-editor\s*\{[^}]*position:\s*absolute/)
assert.match(extension, /v-model:search-enabled="extensionSearchEnabled"/)
assert.match(extension, /v-model:search-engine-id="widgetPreferences\.searchEngineId"/)
assert.match(extension, /v-model:clock-seconds="extensionClockSeconds"/)
assert.match(extension, /v-model:sidebar-wheel-switch="sidebarWheelSwitch"/)
assert.match(extension, /openCardContextMenuFromKeyboard/)
assert.match(extension, /handleContextMenuKeydown/)
assert.match(extensionSettings, /v-model:value="searchEnabledModel"/)
assert.match(extensionSettings, /v-model:value="searchEngineIdModel"/)
assert.match(extensionSettings, /v-model:value="searchHistoryEnabledModel"/)
assert.match(extensionSettings, /v-model:value="clockEnabledModel"/)
assert.match(extensionSettings, /v-model:value="clockHourCycleModel"/)
assert.match(extensionSettings, /v-model:value="sidebarWheelSwitchModel"/)
assert.match(extensionSettings, /currentTab === 'sidebar'/)
assert.match(extensionSettings, /currentTab === 'backup'/)
assert.match(extension, /class="extension-context-menu"/)
assert.match(extension, /bookmarkLayoutChoices/)
assert.match(extension, /activeWidgetSizeChoices/)
assert.match(extension, /resizeInstanceToWithinBounds/)
assert.match(extensionPreferences, /bookmarkLayouts: Record<string, ExtensionBookmarkLayout>/)
assert.match(extensionPreferences, /pageLayouts: Record<string, ExtensionPageLayout>/)
assert.match(extensionPreferences, /Legacy global widget layout/)
assert.match(extensionPreferences, /searchHistory: string\[\]/)
assert.match(extensionPreferences, /MAX_SEARCH_HISTORY = 10/)
assert.match(extension, /runtime\.resolveUrl\(authStore\.userInfo\?\.headImage/)
assert.match(extensionSettings, /label: '个人中心'/)
assert.match(extensionSettings, /<UserInfoApp embedded \/>/)
assert.match(extensionSettings, /<UserSessionsApp embedded \/>/)
assert.match(extensionSettings, /class="hub-brand"/)
assert.doesNotMatch(extensionSettings, /class="feature-banner/, 'control center must use the compact product header, not the retired image banner')
assert.doesNotMatch(extensionSettings, /个人资料与头像/)
assert.match(userCenter, /runtime\.resolveUrl\(authStore\.userInfo\?\.headImage/)
assert.match(userCenter, /authStore\.setUserInfo\(/)
assert.match(userCenter, /updateInfo\(\{ name, mail, headImage \}\)/)
assert.match(userCenter, /v-model:value="nickName"/)
assert.match(userCenter, /v-model:value="profileMail"/)
assert.doesNotMatch(userCenter, /isEditProfileStatus/)
assert.match(userSessions, /revocableSessionCount/)
assert.match(userSessions, /:scroll-x="860"/)
assert.match(extension, /function handleAvatarClick\(\)[\s\S]*router\.push\('\/login'\)/)
assert.match(routerPermission, /__PANEL_RUNTIME__ === 'extension' \? 'Home' : 'login'/)
const settingsIconNames = [...extensionSettings.matchAll(/(?:icon="|icon: ')([a-z0-9:-]+)(?:"|')/gi)].map(match => match[1].replaceAll(':', '-'))
const extensionIconNames = [...new Set([
  ...settingsIconNames,
  ...bundledIconNames(extensionTemplate),
  'mdi-github',
  'ri-bilibili-fill',
  'simple-icons-duckduckgo',
])]
for (const iconName of extensionIconNames)
  assert.ok(localControlIcons.has(iconName), `extension control-center icon must be bundled locally: ${iconName}`)

assert.match(extension, /isPreviewingWidgetResize/)
assert.match(extension, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/)
assert.doesNotMatch(extension, /window\.addEventListener\('wheel', handleGroupWheel/)

console.log('Validated grouped extension rail, constrained context menus, profile rendering, guest-first routing, effective settings, and iOS bookmark icons')
