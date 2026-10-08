<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import { clearSyncFailure, isSyncActive, syncFailureMessage } from '@/sync/activity'

// inline: sits inside an existing top-right status bar instead of floating.
const props = defineProps<{ inline?: boolean }>()

// Quick saves finish before the delay and never flash the indicator; once
// shown it stays long enough for one turn of the animation to read.
const SHOW_DELAY = 250
const MIN_VISIBLE = 700

const spinning = ref(false)
let shownAt = 0
let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined

watch(isSyncActive, (active) => {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  if (active) {
    if (!spinning.value)
      showTimer = setTimeout(() => { spinning.value = true; shownAt = Date.now() }, SHOW_DELAY)
    return
  }
  if (spinning.value)
    hideTimer = setTimeout(() => { spinning.value = false }, Math.max(0, MIN_VISIBLE - (Date.now() - shownAt)))
}, { immediate: true })

onBeforeUnmount(() => {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
})

const failed = computed(() => Boolean(syncFailureMessage.value) && !spinning.value)
const visible = computed(() => spinning.value || failed.value)
const label = computed(() => failed.value ? syncFailureMessage.value : '正在同步')
</script>

<template>
  <Transition name="sync-indicator">
    <button
      v-if="visible"
      type="button"
      class="sync-indicator"
      :class="{ 'is-failed': failed, 'is-inline': props.inline }"
      :title="failed ? `${label}（点击关闭）` : label"
      :aria-label="label"
      :disabled="!failed"
      role="status"
      @click="clearSyncFailure"
    >
      <SvgIcon icon="material-symbols:sync" class="sync-indicator-icon" />
      <span v-if="failed" class="sync-indicator-dot" aria-hidden="true" />
    </button>
  </Transition>
</template>

<style scoped>
.sync-indicator {
  position: fixed;
  top: 14px;
  right: 16px;
  z-index: 3000;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--pn-glass-border, rgba(255, 255, 255, .35));
  border-radius: 999px;
  color: var(--pn-color-text, #333);
  background: var(--pn-glass-surface, rgba(255, 255, 255, .72));
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .12);
  font-size: 16px;
  cursor: default;
}
.sync-indicator.is-inline { position: relative; top: auto; right: auto; z-index: auto; }
.sync-indicator.is-failed { color: #d03050; cursor: pointer; }
.sync-indicator-icon { width: 16px; height: 16px; }
.sync-indicator:not(.is-failed) .sync-indicator-icon { animation: sync-indicator-spin 1s linear infinite; }
.sync-indicator-dot {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #d03050;
}
.sync-indicator-enter-active, .sync-indicator-leave-active { transition: opacity .2s ease, transform .2s ease; }
.sync-indicator-enter-from, .sync-indicator-leave-to { opacity: 0; transform: scale(.8); }
@keyframes sync-indicator-spin { to { transform: rotate(-360deg); } }
@media (prefers-reduced-motion: reduce) {
  .sync-indicator:not(.is-failed) .sync-indicator-icon { animation-duration: 2.4s; }
}
</style>
