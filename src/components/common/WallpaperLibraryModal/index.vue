<script setup lang="ts">
import { NModal } from 'naive-ui'
import GallerySelector from '../GallerySelector/index.vue'

defineProps<{ show: boolean }>()
defineEmits<{ 'update:show': [show: boolean]; select: [url: string] }>()
</script>

<template>
  <NModal :show="show" to=".pn-theme-root" preset="card" title="壁纸库" class="wallpaper-library-modal" @update:show="$emit('update:show', $event)">
    <GallerySelector type="wallpaper" @select="$emit('select', $event)" />
  </NModal>
</template>

<style>
.wallpaper-library-modal.n-card { width: min(1200px, calc(100vw - 48px)); height: min(900px, 85dvh); max-height: calc(100dvh - 32px); border-radius: 24px; overflow: hidden; }
.wallpaper-library-modal > .n-card-header { flex: none; padding: 18px 24px; }
.wallpaper-library-modal > :is(.n-card-content, .n-card__content) { display: flex; flex: 1; min-height: 0; padding: 0; overflow: hidden; }
@media (max-width: 640px) {
  .wallpaper-library-modal.n-card { width: calc(100vw - 16px); height: calc(100dvh - 24px); max-height: calc(100dvh - 24px); border-radius: 18px; }
  .wallpaper-library-modal > .n-card-header { padding: 14px 16px; }
}
</style>
