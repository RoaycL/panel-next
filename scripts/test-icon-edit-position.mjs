import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('src/views/extension/index.vue', 'utf8')
const body = source.slice(source.indexOf('function handleEditSuccess('), source.indexOf('\nfunction handleGroupIconSaved('))
  .replace(/^function handleEditSuccess[^\n]+\n/, '')
  .replace('updated as Panel.ItemInfo', 'updated').replace(/\}\s*$/, '')
const run = new Function('updated', 'meta', 'groups', 'editCardModalVisible', 'refreshBootstrap', body)
const item = (id, group = 1) => ({ id, itemIconGroupId: group, title: `Item ${id}`, sort: id, createTime: '2026-10-01' })
const groups = { value: [{ id: 1, items: [item(1), item(2), item(3)] }, { id: 2, items: [item(4, 2)] }] }
let refreshes = 0
const save = (updated, queued = false) => run(updated, { queued }, groups, { value: true }, () => refreshes++)
save({ ...item(2), title: 'Edited' })
assert.deepEqual(groups.value[0].items.map(i => i.id), [1, 2, 3], 'Editing must not move the item to the end')
assert.equal(groups.value[0].items[1].title, 'Edited')
save({ ...item(2), title: 'Offline edit' }, true)
assert.equal(refreshes, 1, 'Queued edits must not fetch a stale server snapshot')
assert.deepEqual(groups.value[0].items.map(i => i.id), [1, 2, 3])
save(item(2, 2))
assert.deepEqual(groups.value[0].items.map(i => i.id), [1, 3])
assert.deepEqual(groups.value[1].items.map(i => i.id), [2, 4], 'Moved items must match server sorting immediately')
save(item(5, 2))
assert.deepEqual(groups.value[1].items.map(i => i.id), [2, 4, 5])
console.log('Icon edits retain positions, queued edits and group moves passed.')
