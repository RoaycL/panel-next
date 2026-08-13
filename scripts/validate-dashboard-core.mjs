import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/dashboard/core.ts', import.meta.url), 'utf8')
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
const { createDashboardState, createItemSortRequest, filterDashboardGroups, selectItemUrl }
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
assert.equal(filterDashboardGroups(dashboard.groups, 'missing', false), dashboard.groups)

assert.deepEqual(createItemSortRequest(dashboard.groups[0]), {
  itemIconGroupId: 11,
  sortItems: [{ id: 12, sort: 1 }],
})
assert.equal(selectItemUrl(dashboard.groups[0].items[0], true), 'http://example.lan')
assert.equal(selectItemUrl({ ...dashboard.groups[0].items[0], lanUrl: '' }, true), 'https://example.com')

console.log('Validated shared dashboard state, search, sorting, and URL selection')
