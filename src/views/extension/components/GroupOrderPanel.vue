<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { VueDraggable } from 'vue-draggable-plus'
import GroupIcon from '@/components/common/GroupIcon/index.vue'
import { saveSort } from '@/api/panel/itemIconGroup'
import { useAuthStore } from '@/store'
import { getRuntime } from '@/runtime'

const props = defineProps<{ groups: Panel.ItemIconGroup[] }>()
const emit = defineEmits<{ (event: 'saved', ids: number[], meta: { queued: boolean }): void }>()
const auth = useAuthStore()
const runtime = getRuntime()
const message = useMessage()
const draft = ref<Panel.ItemIconGroup[]>([])
const saving = ref(false)
const dirty = computed(() => draft.value.map(group => group.id).join(',') !== props.groups.map(group => group.id).join(','))
function reset() { draft.value = props.groups.map(group => ({ ...group })) }
watch(() => props.groups.map(group => `${group.id}:${group.sort}:${group.title}:${group.icon}`).join('|'), reset, { immediate: true })
function move(index: number, offset: number) {
  const target = index + offset
  if (saving.value || target < 0 || target >= draft.value.length) return
  const copy = [...draft.value]
  const [item] = copy.splice(index, 1)
  copy.splice(target, 0, item)
  draft.value = copy
}
async function save() {
  if (!auth.token || !dirty.value || saving.value) return
  const accountId = auth.userInfo?.id
  const origin = runtime.getServerOrigin()
  const ids = draft.value.map(group => group.id as number)
  saving.value = true
  try {
    const result = await saveSort(ids.map((id, index) => ({ id, sort: index + 1 })))
    if (result.code !== 0) throw new Error(result.msg || '保存排序失败')
    if (!auth.token || auth.userInfo?.id !== accountId || runtime.getServerOrigin() !== origin)
      throw new Error('账号或服务器已切换，请刷新页面')
    emit('saved', ids, { queued: Boolean(result.queued) })
    if (result.queued) message.info(result.conflict ? '分组排序已进入待同步队列，请处理云端冲突' : '分组排序已保存，联网后同步')
    else message.success('分组排序已保存并同步')
  }
  catch (error) { message.error(error instanceof Error ? error.message : '保存排序失败，请重试') }
  finally { saving.value = false }
}
</script>

<template>
  <details v-if="auth.token && groups.length > 1" class="group-order-panel">
    <summary>分组排序 <span>{{ groups.length }} 个分组 · 点击展开</span></summary>
    <p>拖动左侧手柄，或用上下按钮调整；保存后侧栏与首页使用相同顺序。</p>
    <VueDraggable v-model="draft" item-key="id" class="group-order-list" handle=".group-order-handle" :disabled="saving" :animation="160" ghost-class="group-order-ghost">
      <div v-for="(group, index) in draft" :key="group.id" class="group-order-row">
        <span class="group-order-handle" title="拖动排序" aria-hidden="true">⠿</span>
        <GroupIcon :icon="group.icon" :title="group.title" :size="24" />
        <span class="group-order-title">{{ group.title || '未命名分组' }}</span>
        <button type="button" :aria-label="`上移${group.title}`" :disabled="saving || index === 0" @click="move(index, -1)">
          ↑
        </button>
        <button type="button" :aria-label="`下移${group.title}`" :disabled="saving || index === draft.length - 1" @click="move(index, 1)">
          ↓
        </button>
      </div>
    </VueDraggable>
    <div class="group-order-actions">
      <NButton type="primary" :loading="saving" :disabled="!dirty" @click="save">
        保存分组排序
      </NButton>
      <NButton :disabled="saving || !dirty" @click="reset">
        还原顺序
      </NButton>
    </div>
  </details>
</template>

<style scoped>
.group-order-panel { min-width: 0; padding-bottom: 16px; border-bottom: 1px solid var(--pn-glass-border); }
summary { cursor: pointer; color: var(--pn-color-text-primary); font-size: 14px; font-weight: 600; }
summary span, p { font-size: 12px; color: var(--pn-color-text-muted); font-weight: 400; }
summary span { margin-left: 8px; }
p { margin: 12px 0; line-height: 1.6; }
.group-order-list { display: grid; gap: 8px; max-height: 320px; overflow-y: auto; overscroll-behavior: contain; padding: 2px; scrollbar-gutter: stable; }
.group-order-row { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 48px; padding: 6px 10px; border: 1px solid var(--pn-glass-border); border-radius: 12px; background: var(--pn-glass-control); }
.group-order-handle { cursor: grab; touch-action: none; color: var(--pn-color-text-muted); font-size: 22px; flex: none; }
.group-order-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pn-color-text-primary); font-size: 13px; }
/* Row arrows only: a bare `button` selector also squeezed the save/restore NButtons to 30px. */
.group-order-row > button { flex: none; width: 30px; height: 30px; border: 1px solid var(--pn-glass-border); border-radius: 8px; background: var(--pn-glass-control); color: var(--pn-color-text-primary); cursor: pointer; }
.group-order-row > button:disabled { opacity: .35; cursor: not-allowed; }
.group-order-row > button:focus-visible, summary:focus-visible { outline: 2px solid var(--pn-color-accent); outline-offset: 2px; }
.group-order-ghost { opacity: .4; }
.group-order-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
</style>
