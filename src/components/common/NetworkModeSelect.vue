<script setup lang="ts">
import { computed } from 'vue'
import { NSelect } from 'naive-ui'
import { usePanelState } from '@/store'
import { PanelStateNetworkModeEnum } from '@/enums'
const panel = usePanelState()
const mode = computed({ get: () => panel.networkMode ?? PanelStateNetworkModeEnum.auto, set: value => panel.setNetworkMode(value) })
const options = [{ label: '自动', value: 2 }, { label: '公网', value: 1 }, { label: '内网', value: 0 }]
</script>
<template>
  <div class="network-mode-setting">
    <div><strong>书签访问模式</strong><small>自动优先使用可检测到的内网地址；检测受限时回退公网，可手动选择内网。</small></div>
    <NSelect v-model:value="mode" :options="options" aria-label="书签访问模式" />
  </div>
</template>
<style scoped>
.network-mode-setting { display: flex; align-items: center; gap: 16px; padding: 14px 0; }
.network-mode-setting > div { flex: 1; min-width: 0; }
.network-mode-setting strong { display: block; font-size: 13px; }
.network-mode-setting small { display: block; margin-top: 6px; line-height: 1.6; color: var(--pn-color-text-secondary); }
.network-mode-setting :deep(.n-select) { width: 120px; flex-shrink: 0; }
</style>
