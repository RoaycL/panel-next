<script setup lang="ts">
import { computed, ref } from 'vue'
import SvgIcon from './SvgIcon/index.vue'

const props = defineProps<{ entries: string[]; query: string; visible: boolean; id: string }>()
const emit = defineEmits<{ (e: 'select', query: string): void; (e: 'remove', query: string): void; (e: 'clear'): void; (e: 'close'): void }>()
const panel = ref<HTMLElement | null>(null)
const filtered = computed(() => props.entries.filter(item => item.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase())))
function focusEntry(last = false) {
  const buttons = panel.value?.querySelectorAll<HTMLButtonElement>('.history-query')
  if (buttons?.length) buttons[last ? buttons.length - 1 : 0].focus()
}
function moveFocus(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
  const buttons = Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('.history-query') ?? [])
  const current = buttons.indexOf(event.target as HTMLButtonElement)
  if (current < 0 || !buttons.length) return
  event.preventDefault()
  buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus()
}
defineExpose({ focusEntry })
</script>

<template>
  <Transition name="search-history">
    <div v-if="visible && entries.length" :id="id" ref="panel" class="search-history-panel" @keydown="moveFocus" @keydown.esc.stop.prevent="emit('close')">
      <div class="history-heading">
        <span>最近搜索</span><button type="button" @click="emit('clear')">
          清空历史
        </button>
      </div>
      <ul v-if="filtered.length" aria-label="搜索历史">
        <li v-for="entry in filtered" :key="entry">
          <button type="button" class="history-query" @click="emit('select', entry)">
            <SvgIcon icon="panel-next-timer" /><span>{{ entry }}</span><small>填入</small>
          </button>
          <button type="button" class="history-remove" :aria-label="`删除搜索历史：${entry}`" title="删除这条历史" @click="emit('remove', entry)">
            <SvgIcon icon="material-symbols:close-rounded" />
          </button>
        </li>
      </ul>
      <p v-else>
        没有匹配的历史，按回车搜索当前内容
      </p>
      <footer>仅保存在本机 · ↑ ↓ 选择 · Esc 收起</footer>
    </div>
  </Transition>
</template>

<style scoped>
.search-history-panel { position: absolute; z-index: 30; top: calc(100% + 10px); inset-inline: 0; padding: 10px; border: 1px solid var(--pn-glass-border, rgb(255 255 255 / 24%)); border-radius: 20px; background: var(--pn-glass-floating, rgb(25 25 28 / 85%)); color: var(--pn-color-text-primary, white); backdrop-filter: blur(28px) saturate(140%); -webkit-backdrop-filter: blur(28px) saturate(140%); box-shadow: 0 12px 40px rgb(0 0 0 / 14%); text-shadow: none; }
.history-heading { display: flex; align-items: center; justify-content: space-between; padding: 3px 8px 8px; font-size: 12px; color: var(--pn-color-text-secondary); }
.history-heading button { border: 0; padding: 5px 8px; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
ul { margin: 0; padding: 0; max-height: min(320px, 40vh); overflow: auto; list-style: none; }
li { display: flex; align-items: center; border-radius: 10px; }
li:hover, li:focus-within { background: var(--pn-glass-control, rgb(255 255 255 / 10%)); }
.history-query { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; padding: 11px 10px; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; font-size: 14px; }
.history-query span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-query small { color: var(--pn-color-text-secondary); font-size: 10px; opacity: 0; }
li:hover small, li:focus-within small { opacity: 1; }
.history-query :deep(svg) { width: 18px; height: 18px; flex: none; color: var(--pn-color-text-secondary); }
.history-remove { display: grid; place-items: center; width: 32px; height: 32px; margin-right: 5px; border: 0; border-radius: 8px; background: transparent; color: var(--pn-color-text-secondary); cursor: pointer; }
.history-remove :deep(svg) { width: 16px; height: 16px; }
button:focus-visible { outline: 2px solid var(--pn-color-accent); outline-offset: -2px; }
footer, p { margin: 0; padding: 8px; font-size: 11px; color: var(--pn-color-text-secondary); }
footer { border-top: 1px solid var(--pn-glass-border); margin-top: 6px; }
.search-history-enter-active, .search-history-leave-active { transition: opacity 140ms ease, transform 140ms ease; }
.search-history-enter-from, .search-history-leave-to { opacity: 0; transform: translateY(-5px); }
@media (prefers-reduced-motion: reduce) { .search-history-enter-active, .search-history-leave-active { transition: none; } }
</style>
