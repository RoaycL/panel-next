<script setup lang="ts">
import { extensionUpdateAvailable, extensionUpdateState, dismissExtensionUpdate } from '@/runtime/extensionUpdates'
</script>

<template>
  <aside v-if="extensionUpdateAvailable && extensionUpdateState.latest" class="extension-update-notice" role="status">
    <div><strong>发现新版 v{{ extensionUpdateState.latest.version }}</strong><p>下载并替换扩展文件后，重新加载扩展即可更新。</p></div>
    <div class="update-notice-actions">
      <a :href="extensionUpdateState.latest.downloadUrl" target="_blank" rel="noopener noreferrer">下载更新</a>
      <a :href="extensionUpdateState.latest.releaseUrl" target="_blank" rel="noopener noreferrer">更新说明</a>
      <button type="button" @click="dismissExtensionUpdate().catch(() => {})">暂不提醒</button>
    </div>
  </aside>
</template>

<style scoped>
.extension-update-notice { position: fixed; z-index: 1200; top: 18px; right: 18px; width: min(360px, calc(100vw - 36px)); padding: 18px; border: 1px solid var(--pn-glass-border); border-radius: 18px; color: var(--pn-color-text-primary); background: var(--pn-glass-panel); box-shadow: var(--pn-glass-highlight), var(--pn-glass-shadow); backdrop-filter: var(--pn-glass-filter); -webkit-backdrop-filter: var(--pn-glass-filter); }
.extension-update-notice p { margin: 8px 0 14px; color: var(--pn-color-text-secondary); font-size: 12px; line-height: 1.6; }
.update-notice-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; font-size: 12px; }
.update-notice-actions a { color: var(--pn-color-accent); }
.update-notice-actions button { margin-left: auto; color: var(--pn-color-text-secondary); cursor: pointer; }
</style>
