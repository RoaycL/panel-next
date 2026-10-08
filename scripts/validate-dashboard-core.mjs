import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/dashboard/core.ts', import.meta.url), 'utf8')
const extensionView = fs.readFileSync(new URL('../src/views/extension/index.vue', import.meta.url), 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'core.ts',
  reportDiagnostics: true,
})
if (transpiled.diagnostics?.length) {
  throw new Error(transpiled.diagnostics
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    .join('\n'))
}
const encoded = Buffer.from(transpiled.outputText).toString('base64')
const { createDashboardState, createItemSortRequest, filterDashboardGroups, isDesktopGroup, selectItemUrl, sortDashboardGroups }
  = await import(`data:text/javascript;base64,${encoded}`)

const bootstrap = {
  schemaVersion: 1,
  revision: '4',
  generatedAt: '2026-08-13T00:00:00Z',
  account: { id: 7, username: 'user', name: 'User', headImage: '', role: 2, mail: '', status: 1 },
  panel: {
    revision: '1',
    config: { searchBoxSearchIcon: true },
    searchEngine: {},
    groups: [{
      id: 11,
      createTime: '2026-08-13T00:00:00Z',
      updateTime: '2026-08-13T00:00:00Z',
      icon: 'apps',
      title: 'Tools',
      description: 'Shared tools',
      sort: 1,
      revision: '2',
      items: [{
        id: 12,
        createTime: '2026-08-13T00:00:00Z',
        updateTime: '2026-08-13T00:00:00Z',
        icon: { itemType: 1, src: 'icon.svg' },
        title: 'Example',
        url: 'https://example.com',
        lanUrl: 'http://example.lan',
        description: 'Internal app',
        openMethod: 2,
        sort: 1,
        revision: '3',
        itemIconGroupId: 11,
      }],
    }],
  },
}

const dashboard = createDashboardState(bootstrap)
assert.equal(dashboard.groups[0].hoverStatus, false)
assert.notEqual(dashboard.groups, bootstrap.panel.groups)

const filtered = filterDashboardGroups(dashboard.groups, 'internal', true)
assert.equal(filtered.length, 1)
assert.equal(filtered[0].id, 11)
assert.equal(filtered[0].title, 'Tools')
assert.equal(filtered[0].items[0].id, 12)
assert.equal(filterDashboardGroups(dashboard.groups, 'missing', true).length, 0)
assert.deepEqual(filterDashboardGroups(dashboard.groups, 'missing', false), dashboard.groups)
const legacySystemGroup = { ...dashboard.groups[0], id: 99, title: '系统' }
const groupsWithSystem = [...dashboard.groups, legacySystemGroup]
assert.equal(isDesktopGroup(legacySystemGroup), false)
assert.equal(isDesktopGroup({ title: ' System ' }), false)
assert.equal(isDesktopGroup({ title: '系统工具' }), true)
assert.deepEqual(filterDashboardGroups(groupsWithSystem, '', false), dashboard.groups)
assert.deepEqual(filterDashboardGroups(groupsWithSystem, 'internal', true), filtered)
assert.equal(groupsWithSystem.length, 2, 'Hiding the old settings page must not delete its data')
assert.match(extensionView, /groups\.value\.filter\(isDesktopGroup\)/)
assert.match(extensionView, /<Transition :name="`group-slide-\$\{groupSlideDirection\}`" mode="out-in">/)
assert.match(extensionView, /:key="activeTabId \?\? 'empty'"/)
assert.match(extensionView, /selectGroup\(groupTabs\.value\[nextIndex\]\.id, direction > 0 \? 'next' : 'previous'\)/)
assert.match(extensionView, /@media \(prefers-reduced-motion: reduce\)/)

assert.deepEqual(createItemSortRequest(dashboard.groups[0]), {
  itemIconGroupId: 11,
  sortItems: [{ id: 12, sort: 1 }],
})
assert.equal(selectItemUrl(dashboard.groups[0].items[0], true), 'http://example.lan')
assert.equal(selectItemUrl({ ...dashboard.groups[0].items[0], lanUrl: '' }, true), 'https://example.com')
assert.match(extensionView, /groups\.value = dashboard\.groups \|\| \[\]/)
assert.match(extensionView, /if \(authStore\.visitMode !== VisitMode\.VISIT_MODE_LOGIN\)\s+return/)
assert.match(extensionView, /type="button" class="rail-avatar"[\s\S]*@click="handleAvatarClick"/)
assert.match(extensionView, /v-for="group in groupTabs"/)
assert.match(extensionView, /function openGroupManager\(\)[\s\S]*VisitMode\.VISIT_MODE_LOGIN/)
// Signed out: the extension shows starter sites, the web panel the public account (read-only).
assert.match(extensionView, /async function showSignedOutDashboard\(\) \{\s*authStore\.setVisitMode\(VisitMode\.VISIT_MODE_PUBLIC\)\s*if \(!isWebRuntime\) \{\s*showPresetGroups\(\)/)
assert.match(extensionView, /if \(!authStore\.token\) \{[\s\S]*?await showSignedOutDashboard\(\)/)
assert.match(extensionView, /const canArrangeDashboard = computed\(\(\) => !isWebRuntime \|\| authStore\.visitMode === VisitMode\.VISIT_MODE_LOGIN\)/)

const reordered = createDashboardState({ ...bootstrap, panel: { ...bootstrap.panel, groups: [
  { ...bootstrap.panel.groups[0], id: 1, title: 'First created', sort: 3 },
  { ...bootstrap.panel.groups[0], id: 2, title: 'Moved to top', sort: 1 },
  { ...bootstrap.panel.groups[0], id: 3, title: 'Tie keeps order', sort: 3 },
] } })
assert.deepEqual(reordered.groups.map(group => group.id), [2, 1, 3], 'Pages follow group sort, ties keep server order')
assert.deepEqual(sortDashboardGroups([{ id: 5 }, { id: 6, sort: 1 }]).map(group => group.id), [6, 5])
// The guest preset uses id 1, which is often an account's first-created group.
assert.match(extensionView, /if \(followFirstGroup \|\| !tabs\.some\(tab => tab\.id === activeTabId\.value\)\)\s*activeTabId\.value = tabs\[0\]\.id/)
assert.match(extensionView, /function selectGroup[\s\S]*?followFirstGroup = false/)
assert.match(extensionView, /function showPresetGroups\(\) \{\s*followFirstGroup = true/)
assert.doesNotMatch(extensionView, /v-model:page-id="activeTabId"/, 'Picking a page in the add center is a user selection')

console.log('Validated shared dashboard state, compact group rail, guest interactions, sorting, and URL selection')
