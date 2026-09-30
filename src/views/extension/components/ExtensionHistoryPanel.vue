<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NEmpty, NPopconfirm, useMessage } from 'naive-ui'
import { readExtensionLayoutHistory, restoreExtensionLayoutHistory } from '@/runtime/extensionHistory'
import type { ExtensionLayoutHistoryEntry } from '@/runtime/extensionHistory'

const message = useMessage()
const entries = ref<ExtensionLayoutHistoryEntry[]>(readExtensionLayoutHistory())
const restoring = ref<string | null>(null)
const selected = ref<string | null>(null)
const selectedEntry = computed(() => entries.value.find(entry => entry.id === selected.value) ?? null)

function refresh() {
  entries.value = readExtensionLayoutHistory()
}

function widgetCount(entry: ExtensionLayoutHistoryEntry) {
  const pages = Object.values(entry.snapshot.widgets.pageLayouts ?? {})
  return pages.reduce((count, page) => count + (page.contentLayout?.widgets?.length ?? 0), 0)
    + (entry.snapshot.widgets.contentLayout?.widgets?.length ?? 0)
}

async function restore(id: string) {
  restoring.value = id
  try {
    await restoreExtensionLayoutHistory(id)
    message.success('布局已恢复，正在重新加载页面')
    window.location.reload()
  }
  catch (error) {
    message.error(error instanceof Error ? error.message : '恢复失败，请检查当前布局与恢复前备份')
    refresh()
  }
  finally {
    restoring.value = null
  }
}
</script>

<template>
  <section class="settings-glass-card layout-history">
    <div class="history-heading">
      <div>
        <h3>本机布局历史</h3>
        <p>自动保留最近的外观与小组件布局版本；访客也可使用。书签和分组不在本机布局回滚范围内。</p>
      </div>
      <NButton size="small" tertiary @click="refresh">
        刷新
      </NButton>
    </div>
    <NEmpty v-if="entries.length === 0" description="修改布局或外观后，历史版本会出现在这里" class="history-empty" />
    <div v-else class="history-list">
      <button
        v-for="entry in entries"
        :key="entry.id"
        type="button"
        class="history-entry"
        :class="{ selected: selected === entry.id }"
        @click="selected = entry.id"
      >
        <span class="history-dot" />
        <span class="history-copy">
          <strong>{{ entry.label }}</strong>
          <small>{{ new Date(entry.createdAt).toLocaleString() }} · {{ widgetCount(entry) }} 个组件</small>
        </span>
      </button>
    </div>
    <div v-if="selectedEntry" class="history-restore">
      <span>恢复前会先保留当前布局，方便再次找回。</span>
      <NPopconfirm @positive-click="restore(selectedEntry.id)">
        <template #trigger>
          <NButton type="primary" size="small" :loading="restoring === selectedEntry.id">
            恢复此版本
          </NButton>
        </template>
        确定用 {{ new Date(selectedEntry.createdAt).toLocaleString() }} 的布局替换当前布局吗？
      </NPopconfirm>
    </div>
  </section>
</template>

<style scoped>
.layout-history { display: grid; gap: 16px; }
.history-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.history-heading h3 { margin: 0 0 6px; font-size: 16px; font-weight: 700; }
.history-heading p { margin: 0; color: var(--pn-color-text-muted, #64748b); font-size: 12px; line-height: 1.6; }
.history-list { display: grid; max-height: 300px; overflow: auto; gap: 8px; }
.history-entry { display: flex; align-items: center; width: 100%; gap: 12px; padding: 10px 12px; text-align: left; border: 1px solid var(--pn-glass-border, var(--pn-color-border)); border-radius: 12px; background: var(--pn-glass-control, var(--pn-color-surface)); color: inherit; cursor: pointer; }
.history-entry:hover, .history-entry.selected { border-color: var(--pn-color-accent, #2fae91); background: color-mix(in srgb, var(--pn-color-accent, #10b981) 10%, var(--pn-glass-control, transparent)); }
.history-dot { width: 9px; height: 9px; flex: 0 0 9px; border-radius: 50%; background: var(--pn-color-accent, #2fae91); }
.history-copy { display: grid; gap: 3px; }
.history-copy strong { font-size: 13px; }
.history-copy small { color: var(--pn-color-text-muted, #64748b); font-size: 12px; }
.history-restore { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 10px; border-top: 1px solid rgb(148 163 184 / 15%); font-size: 12px; }
.history-empty { padding: 20px 0; }
.history-entry:focus-visible { outline: 2px solid var(--pn-color-accent); outline-offset: 2px; }
@media (max-width: 560px) { .history-restore { align-items: stretch; flex-direction: column; } }
</style>
