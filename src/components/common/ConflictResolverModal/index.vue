<script setup lang="ts">
import { computed } from 'vue'
import {
  NButton,
  NModal,
  NTag,
} from 'naive-ui'
import { SvgIcon } from '@/components/common'
import type { ConflictDescriptor, ConflictResolutionChoice } from '@/sync/conflictResolver'

const props = defineProps<{
  show: boolean
  conflict: ConflictDescriptor | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'resolve', choice: ConflictResolutionChoice): void
}>()

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

function handleChoice(choice: ConflictResolutionChoice) {
  emit('resolve', choice)
  visible.value = false
}

// 「另存副本」依赖重放端把编辑转新增，仅对可复制资源开放
const supportsDuplicate = computed(() =>
  props.conflict?.action === 'item.edit' || props.conflict?.action === 'group.edit',
)

</script>

<template>
  <NModal
    v-model:show="visible"
    preset="card"
    :bordered="false"
    :mask-closable="false"
    :closable="false"
    :close-on-esc="false"
    style="width: min(680px, calc(100vw - 24px)); max-height: calc(100vh - 24px); border-radius: 20px; overflow: hidden; background: rgba(2, 6, 23, 0.98); border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: 0 28px 90px rgba(2, 6, 23, 0.62);"
    class="conflict-resolver-modal"
  >
    <div class="conflict-modal-content p-6 bg-slate-950 text-slate-100 space-y-6">
      <!-- 弹窗头部：警告指示 -->
      <div class="flex items-start space-x-3.5 pb-4 border-b border-white/10">
        <div class="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-xl shrink-0 mt-0.5">
          <SvgIcon icon="material-symbols:sync-problem-rounded" />
        </div>
        <div class="space-y-1 flex-1">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-bold text-white flex items-center space-x-2">
              <span>离线数据同步冲突检测</span>
              <NTag size="small" type="warning" round :bordered="false">
                需要人工确认
              </NTag>
            </h3>
          </div>
          <p class="text-xs text-white/60">
            在您离线期间，云端其他设备对同一下列资源进行了更新。请选择如何保留您的修改，拒绝静默覆盖：
          </p>
        </div>
      </div>

      <!-- 冲突条目概要 -->
      <div v-if="conflict" class="space-y-4">
        <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.04] border border-white/10 text-xs">
          <div class="flex items-center space-x-2">
            <span class="text-white/50">冲突目标:</span>
            <span class="font-bold text-emerald-400">{{ conflict.resourceName }}</span>
          </div>
          <div class="flex items-center space-x-1 text-white/50">
            <span>冲突字段:</span>
            <span class="text-amber-300 font-mono">{{ conflict.diffFields.join(', ') || '版本差异' }}</span>
          </div>
        </div>

        <!-- 对比面板：本地版本 vs 云端版本 -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- 本地离线修改 -->
          <div class="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-emerald-400 flex items-center space-x-1">
                <SvgIcon icon="material-symbols:phone-android-rounded" />
                <span>本地离线版本 (当前设备)</span>
              </span>
              <span class="text-[10px] text-emerald-400/70">
                {{ new Date(conflict.localVersion.timestamp).toLocaleTimeString() }}
              </span>
            </div>
            <div class="text-xs text-white/80 space-y-1.5 font-mono bg-black/30 p-2.5 rounded-lg max-h-36 overflow-y-auto">
              <div v-if="conflict.localVersion.data?.title">
                <span class="text-white/40">标题: </span>
                <span class="text-emerald-300">{{ conflict.localVersion.data.title }}</span>
              </div>
              <div v-if="conflict.localVersion.data?.url">
                <span class="text-white/40">URL: </span>
                <span class="text-white/90 break-all">{{ conflict.localVersion.data.url }}</span>
              </div>
              <div v-if="conflict.localVersion.data?.lanUrl">
                <span class="text-white/40">内网: </span>
                <span class="text-white/90 break-all">{{ conflict.localVersion.data.lanUrl }}</span>
              </div>
              <div v-if="conflict.localVersion.data?.description">
                <span class="text-white/40">描述: </span>
                <span class="text-white/70">{{ conflict.localVersion.data.description }}</span>
              </div>
            </div>
          </div>

          <!-- 云端最新版本 -->
          <div class="p-4 rounded-xl bg-sky-950/20 border border-sky-500/30 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-sky-400 flex items-center space-x-1">
                <SvgIcon icon="material-symbols:cloud-done-rounded" />
                <span>云端最新版本 (其他端)</span>
              </span>
              <span class="text-[10px] text-sky-400/70">
                Rev: {{ conflict.remoteVersion.revision }}
              </span>
            </div>
            <div class="text-xs text-white/80 space-y-1.5 font-mono bg-black/30 p-2.5 rounded-lg max-h-36 overflow-y-auto">
              <div v-if="!conflict.remoteVersion.data" class="text-red-400 italic">
                该资源在云端已被删除
              </div>
              <template v-else>
                <div v-if="conflict.remoteVersion.data?.title">
                  <span class="text-white/40">标题: </span>
                  <span class="text-sky-300">{{ conflict.remoteVersion.data.title }}</span>
                </div>
                <div v-if="conflict.remoteVersion.data?.url">
                  <span class="text-white/40">URL: </span>
                  <span class="text-white/90 break-all">{{ conflict.remoteVersion.data.url }}</span>
                </div>
                <div v-if="conflict.remoteVersion.data?.lanUrl">
                  <span class="text-white/40">内网: </span>
                  <span class="text-white/90 break-all">{{ conflict.remoteVersion.data.lanUrl }}</span>
                </div>
                <div v-if="conflict.remoteVersion.data?.description">
                  <span class="text-white/40">描述: </span>
                  <span class="text-white/70">{{ conflict.remoteVersion.data.description }}</span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- 决策按钮组 -->
      <div class="pt-2 flex flex-col sm:flex-row items-center justify-end space-y-2 sm:space-y-0 sm:space-x-3">
        <NButton
          v-if="supportsDuplicate"
          quaternary
          type="info"
          class="w-full sm:w-auto rounded-xl text-xs font-semibold"
          title="保留云端版本，并把本地修改新增为另一份副本"
          @click="handleChoice('duplicate_local')"
        >
          <template #icon>
            <SvgIcon icon="material-symbols:content-copy-outline" />
          </template>
          另存本地副本
        </NButton>

        <NButton
          type="warning"
          secondary
          class="w-full sm:w-auto rounded-xl text-xs font-semibold"
          title="丢弃本地离线修改，使用云端最新内容"
          @click="handleChoice('keep_remote')"
        >
          <template #icon>
            <SvgIcon icon="material-symbols:cloud-download-outline" />
          </template>
          使用云端版本
        </NButton>

        <NButton
          type="primary"
          class="w-full sm:w-auto rounded-xl !bg-emerald-500 hover:!bg-emerald-600 text-xs font-bold"
          title="将当前设备的修改写入云端"
          @click="handleChoice('keep_local')"
        >
          <template #icon>
            <SvgIcon icon="material-symbols:cloud-upload-outline" />
          </template>
          使用本地版本
        </NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
:global(.conflict-resolver-modal .n-card__content) {
  padding: 0 !important;
  background: #020617;
}

.conflict-modal-content {
  max-height: calc(100vh - 24px);
  overflow-y: auto;
}

@media (max-width: 560px) {
  .conflict-modal-content {
    padding: 18px;
  }
}
</style>
