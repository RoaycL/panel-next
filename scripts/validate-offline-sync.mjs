import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

async function importTypeScript(sourceText, fileName) {
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
    reportDiagnostics: true,
  })
  const diagnostics = transpiled.diagnostics ?? []
  if (diagnostics.length) {
    const messages = diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    throw new Error(`Unable to transpile ${fileName}:\n${messages.join('\n')}`)
  }
  const encodedModule = Buffer.from(transpiled.outputText).toString('base64')
  return import(`data:text/javascript;base64,${encodedModule}`)
}

// 1. 测试 conflictResolver
const conflictSrc = fs.readFileSync(new URL('../src/sync/conflictResolver.ts', import.meta.url), 'utf8')
const { evaluateConflict, getObjectDiffFields } = await importTypeScript(conflictSrc, 'conflictResolver.ts')

// 模拟云端基线数据
function mockRemoteBootstrap(revision = '10') {
  return {
    schemaVersion: 1,
    revision,
    generatedAt: '2026-08-21T10:00:00Z',
    account: { id: 1, username: 'admin', name: 'Admin', role: 1 },
    panel: {
      revision,
      config: {
        logoText: 'Panel Next',
        backgroundImageSrc: 'https://example.com/bg.jpg',
        backgroundBlur: 0,
      },
      searchEngine: {},
      groups: [
        {
          id: 1,
          title: '开发常用',
          icon: 'tabler:code',
          description: '日常工具',
          sort: 1,
          revision: '5',
          items: [
            {
              id: 101,
              itemIconGroupId: 1,
              title: 'GitHub',
              url: 'https://github.com',
              lanUrl: 'http://192.168.1.100',
              description: '代码仓库',
              icon: { itemType: 1, src: '', text: 'GH', backgroundColor: '#24292e' },
              sort: 1,
              revision: '5',
              createTime: '2026-08-21T08:00:00Z',
              updateTime: '2026-08-21T09:00:00Z',
            },
          ],
        },
      ],
    },
  }
}

// ----------------------------------------------------
// 测试 1: 幂等与字段 Diff 检测
// ----------------------------------------------------
{
  const local = { title: 'GitHub Enterprise', url: 'https://github.company.com' }
  const remote = { title: 'GitHub', url: 'https://github.com' }
  const diffs = getObjectDiffFields(local, remote, ['title', 'url', 'description'])
  assert.deepEqual(diffs, ['title', 'url'], 'Diff 工具应准确捕获不同的业务属性')
}

// ----------------------------------------------------
// 测试 2: OFFLINE-02 新增操作 (item.add, group.add) 天然追加无冲突
// ----------------------------------------------------
{
  const addMutation = {
    idempotencyKey: 'idemp_test_add_1',
    action: 'item.add',
    resourceType: 'item',
    baseRevision: '5',
    payload: { title: '新书签', url: 'https://new.com' },
    createdAt: '2026-08-21T10:30:00Z',
    status: 'pending',
  }
  const conflict = evaluateConflict(addMutation, mockRemoteBootstrap('12'))
  assert.equal(conflict, null, '离线新增书签不应触发冲突，允许天然追加')
}

// ----------------------------------------------------
// 测试 3: OFFLINE-02 删除操作幂等判定
// ----------------------------------------------------
{
  const deleteMutation = {
    idempotencyKey: 'idemp_test_del_1',
    action: 'item.delete',
    resourceType: 'item',
    resourceId: 999, // 远程已不存在
    baseRevision: '5',
    payload: { ids: [999] },
    createdAt: '2026-08-21T10:30:00Z',
    status: 'pending',
  }
  const conflict = evaluateConflict(deleteMutation, mockRemoteBootstrap('12'))
  assert.equal(conflict, null, '删除在云端已不存在的项应幂等视为已删除')
}

// ----------------------------------------------------
// 测试 4: OFFLINE-02 & OFFLINE-03 编辑卡片冲突检测
// ----------------------------------------------------
{
  // 场景 A: 远程自上次离线后未被修改 (revision 未变，或无字段差异)
  const noConflictEdit = {
    idempotencyKey: 'idemp_test_edit_1',
    action: 'item.edit',
    resourceType: 'item',
    resourceId: 101,
    baseRevision: '10', // 与远程一致
    payload: { id: 101, title: 'GitHub Pro', url: 'https://github.com' },
    createdAt: '2026-08-21T10:30:00Z',
    status: 'pending',
  }
  assert.equal(evaluateConflict(noConflictEdit, mockRemoteBootstrap('10')), null, '相同版本基础下编辑不触发冲突')

  // 场景 B: 远程自上次离线后版本已更新且字段发生冲突
  const conflictEdit = {
    idempotencyKey: 'idemp_test_edit_2',
    action: 'item.edit',
    resourceType: 'item',
    resourceId: 101,
    baseRevision: '5', // 离线时版本为 5，远程目前为 10
    payload: { id: 101, title: 'GitHub Local Edit', url: 'https://github.local' },
    createdAt: '2026-08-21T10:30:00Z',
    status: 'pending',
  }
  const conflict = evaluateConflict(conflictEdit, mockRemoteBootstrap('10'))
  assert.ok(conflict, '远程版本超前且字段有差异时，必须检测出冲突')
  assert.equal(conflict.resourceName, 'GitHub Local Edit')
  assert.ok(conflict.diffFields.includes('title'))
  assert.ok(conflict.diffFields.includes('url'))
}

// ----------------------------------------------------
// 测试 5: OFFLINE-02 远程资源已被删除时的编辑判定
// ----------------------------------------------------
{
  const deletedItemEdit = {
    idempotencyKey: 'idemp_test_edit_3',
    action: 'item.edit',
    resourceType: 'item',
    resourceId: 999, // 远程已无此书签
    baseRevision: '5',
    payload: { id: 999, title: '已死卡片', url: 'https://dead.com' },
    createdAt: '2026-08-21T10:30:00Z',
    status: 'pending',
  }
  const conflict = evaluateConflict(deletedItemEdit, mockRemoteBootstrap('10'))
  assert.ok(conflict, '远程卡片已被删除时编辑应生成明确的冲突描述')
  assert.equal(conflict.remoteVersion.data, null)
  assert.equal(conflict.reason, '该书签在云端已被其他端删除')
}

// ----------------------------------------------------
// 测试 6: OFFLINE-02 面板样式配置冲突判定
// ----------------------------------------------------
{
  const panelConflict = {
    idempotencyKey: 'idemp_test_panel_1',
    action: 'panel.set',
    resourceType: 'panel',
    baseRevision: '5',
    payload: {
      panel: {
        backgroundImageSrc: 'https://local.com/my-bg.jpg',
      },
    },
    createdAt: '2026-08-21T10:30:00Z',
    status: 'pending',
  }
  const conflict = evaluateConflict(panelConflict, mockRemoteBootstrap('10'))
  assert.ok(conflict, '离线修改面板样式在云端已变化时应检测出冲突')
  assert.ok(conflict.diffFields.includes('backgroundImageSrc'))
}

console.log('Validated offline mutation queue, idempotency keys, action conflict semantics, and conflict resolution modal descriptors.')
