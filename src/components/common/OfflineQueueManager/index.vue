<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NEmpty, NModal, NTag, useDialog } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { clearOfflineQueue, readOfflineQueue, removeOfflineMutation } from '@/sync/offlineQueue'
import type { OfflineMutation } from '@/sync/offlineQueue'

const props = defineProps<{
  show: boolean
  accountId?: number
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'replay'): void
  (e: 'changed'): void
}>()

const dialog = useDialog()
const queue = ref<OfflineMutation[]>([])

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

watch(() => props.show, (show) => {
  if (show && props.accountId)
    queue.value = readOfflineQueue(props.accountId)
}, { immediate: true })

const ACTION_LABELS: Record<OfflineMutation['action'], string> = {
  'item.add': '新增书签',
  'item.edit': '编辑书签',
  'item.delete': '删除书签',
  'item.sort': '书签排序',
  'group.add': '新增分组',
  'group.edit': '编辑分组',
  'group.delete': '删除分组',
  'group.sort': '分组排序',
  'panel.set': '面板样式与布局',
}

const STATUS_TAGS: Record<OfflineMutation['status'], { label: string, type: 'default' | 'info' | 'warning' | 'error' | 'success' }> = {
  pending: { label: '待同步', type: 'default' },
  replaying: { label: '同步中', type: 'info' },
  conflict: { label: '冲突待裁决', type: 'warning' },
  failed: { label: '失败', type: 'error' },
  applied: { label: '已同步', type: 'success' },
}

function mutationTitle(mutation: OfflineMutation): string {
  const payload = mutation.payload as any
  if (mutation.resourceType === 'panel')
    return '全局面板配置'
  return payload?.title || payload?.name || `#${mutation.resourceId ?? '?'}`
}

async function handleRemove(mutation: OfflineMutation) {
  if (!props.accountId)
    return
  if (await removeOfflineMutation(props.accountId, mutation.idempotencyKey)) {
    queue.value = readOfflineQueue(props.accountId)
    emit('changed')
  }
}

function handleClearAll() {
  if (!props.accountId || queue.value.length === 0)
    return
  dialog.warning({
    title: '清空离线队列',
    content: `将丢弃 ${queue.value.length} 条未同步的本地修改，且无法恢复。确定继续吗？`,
    positiveText: '清空',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (!props.accountId)
        return
      if (await clearOfflineQueue(props.accountId)) {
        queue.value = []
        emit('changed')
      }
    },
  })
}

function handleReplay() {
  emit('replay')
  visible.value = false
}
</script>

<template>
  <NModal
    v-model:show="visible"
    preset="card"
    :bordered="false"
    style="width: min(560px, calc(100vw - 24px)); max-height: calc(100vh - 24px); border-radius: 20px; overflow: hidden; background: rgba(2, 6, 23, 0.98); border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: 0 28px 90px rgba(2, 6, 23, 0.62);"
    class="offline-queue-manager"
    title="离线同步队列"
  >
    <div class="p-1 text-slate-100 space-y-4">
      <div class="flex items-center justify-between text-xs text-white/60">
        <span>以下修改保存在本机，联网后自动按顺序同步到云端。</span>
        <NTag size="small" round :bordered="false" type="info">
          {{ queue.length }} 项
        </NTag>
      </div>

      <NEmpty
        v-if="queue.length === 0"
        description="队列为空，所有修改均已同步"
        class="py-10"
      />

      <div v-else class="space-y-2 overflow-y-auto pr-1" style="max-height: min(420px, calc(100vh - 260px));">
        <div
          v-for="mutation in queue"
          :key="mutation.idempotencyKey"
          class="flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/10 hover:border-white/20 transition-colors"
        >
          <div class="w-8 h-8 rounded-lg bg-sky-500/15 text-sky-300 flex items-center justify-center shrink-0">
            <SvgIcon icon="material-symbols:sync" />
          </div>
          <div class="flex-1 min-w-0 space-y-0.5">
            <div class="flex items-center gap-2 text-xs">
              <span class="font-semibold text-white truncate">{{ mutationTitle(mutation) }}</span>
              <NTag size="tiny" round :bordered="false" :type="STATUS_TAGS[mutation.status].type">
                {{ STATUS_TAGS[mutation.status].label }}
              </NTag>
            </div>
            <div class="text-[11px] text-white/45 truncate">
              {{ ACTION_LABELS[mutation.action] }} · {{ new Date(mutation.createdAt).toLocaleString() }}
            </div>
            <div v-if="mutation.error" class="text-[11px] text-amber-300/80 truncate">
              {{ mutation.error }}
            </div>
          </div>
          <NButton quaternary size="tiny" type="error" class="shrink-0" @click="handleRemove(mutation)">
            <template #icon>
              <SvgIcon icon="material-symbols:delete" />
            </template>
          </NButton>
        </div>
      </div>

      <div class="pt-2 flex items-center justify-between gap-3 border-t border-white/10">
        <NButton
          quaternary
          size="small"
          type="error"
          :disabled="queue.length === 0"
          @click="handleClearAll"
        >
          清空队列
        </NButton>
        <NButton
          size="small"
          type="primary"
          class="!bg-sky-500 hover:!bg-sky-400 font-bold"
          :disabled="queue.length === 0"
          @click="handleReplay"
        >
          <template #icon>
            <SvgIcon icon="material-symbols:sync-rounded" />
          </template>
          立即同步
        </NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
:global(.offline-queue-manager .n-card__content) {
  padding-top: 8px !important;
}
</style>
