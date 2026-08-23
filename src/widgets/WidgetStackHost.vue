<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getRuntime } from '@/runtime'
import WidgetHost from './WidgetHost.vue'
import type { WidgetInstance } from './types'

const props = withDefaults(defineProps<{
  instances: WidgetInstance[]
  editMode?: boolean
}>(), { editMode: false })

const emit = defineEmits<{
  (event: 'activeChange', instance: WidgetInstance): void
  (event: 'itemSearch', keyword?: string): void
}>()

const activeIndex = ref(0)
let wheelLockedUntil = 0
let pointerStart: { id: number; x: number; y: number; startedAt: number } | null = null
let activeStackId: string | null = null

const activeInstance = computed(() => props.instances[activeIndex.value] ?? props.instances[0])
const isStack = computed(() => props.instances.length > 1)
const stackId = computed(() => props.instances[0]?.stack?.id ?? null)

function activeStorageKey(id: string) {
  return `panel-next:widget-stack-active:${id}`
}

function readStoredActiveId(id: string | null) {
  if (!id)
    return null
  try {
    return getRuntime().storage.getItem(activeStorageKey(id))
  }
  catch {
    return null
  }
}

function rememberActiveId(instance: WidgetInstance) {
  const id = stackId.value
  if (!id)
    return
  try {
    getRuntime().storage.setItem(activeStorageKey(id), instance.id)
  }
  catch {
    // 浏览器禁用持久化时仍允许在当前页面切换堆栈。
  }
}

watch(() => props.instances.map(instance => instance.id), (ids) => {
  if (!ids.length) {
    activeIndex.value = 0
    return
  }
  const currentStackId = stackId.value
  const storedId = currentStackId !== activeStackId ? readStoredActiveId(currentStackId) : null
  activeStackId = currentStackId
  const previousId = props.instances[activeIndex.value]?.id
  const preferredId = storedId ?? (previousId && ids.includes(previousId) ? previousId : null)
  const preferredIndex = preferredId ? ids.indexOf(preferredId) : -1
  activeIndex.value = preferredIndex >= 0 ? preferredIndex : Math.min(activeIndex.value, ids.length - 1)
}, { immediate: true })

function select(index: number) {
  const length = props.instances.length
  if (length < 2)
    return
  activeIndex.value = (index + length) % length
  const active = activeInstance.value
  if (active) {
    rememberActiveId(active)
    emit('activeChange', active)
  }
}

function switchBy(delta: number) {
  select(activeIndex.value + delta)
}

function handleWheel(event: WheelEvent) {
  if (!isStack.value || Math.abs(event.deltaY) < 10)
    return
  event.preventDefault()
  event.stopPropagation()
  if (Date.now() < wheelLockedUntil)
    return
  wheelLockedUntil = Date.now() + 280
  switchBy(event.deltaY > 0 ? 1 : -1)
}

function handlePointerDown(event: PointerEvent) {
  if (!isStack.value || event.pointerType === 'mouse')
    return
  const target = event.target
  if (target instanceof Element && target.closest('button, a, input, textarea, select, [contenteditable="true"]'))
    return
  pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, startedAt: Date.now() }
}

function handlePointerUp(event: PointerEvent) {
  const start = pointerStart
  pointerStart = null
  if (!start || start.id !== event.pointerId || Date.now() - start.startedAt > 500)
    return
  const deltaX = event.clientX - start.x
  const deltaY = event.clientY - start.y
  if (Math.abs(deltaY) >= 36 && Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
    event.preventDefault()
    switchBy(deltaY < 0 ? 1 : -1)
  }
}
</script>

<template>
  <div
    class="widget-stack-host"
    :class="{ 'is-stack': isStack }"
    :data-stack-size="instances.length"
    :title="isStack ? $t('widgetLayout.stack.hint') : undefined"
    @wheel="handleWheel"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointercancel="pointerStart = null"
  >
    <div class="widget-stack-stage">
      <Transition name="widget-stack-slide" mode="out-in">
        <WidgetHost
          v-if="activeInstance"
          :key="activeInstance.id"
          :instance="activeInstance"
          :edit-mode="editMode"
          @item-search="emit('itemSearch', $event)"
        />
      </Transition>
    </div>
    <div v-if="isStack" class="widget-stack-indicator" role="tablist" :aria-label="$t('widgetLayout.stack.title')">
      <button
        v-for="(instance, index) in instances"
        :key="instance.id"
        type="button"
        role="tab"
        class="widget-stack-dot"
        :class="{ active: index === activeIndex }"
        :aria-selected="index === activeIndex"
        :aria-label="`${$t('widgetLayout.stack.item')} ${index + 1}`"
        @click.stop="select(index)"
      />
    </div>
    <span v-if="isStack" class="widget-stack-count" aria-hidden="true">{{ activeIndex + 1 }}/{{ instances.length }}</span>
  </div>
</template>

<style scoped>
.widget-stack-host {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.widget-stack-host.is-stack::before,
.widget-stack-host.is-stack::after {
  content: '';
  position: absolute;
  inset: 5px 7px -5px;
  z-index: 0;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: var(--pn-radius-large, 16px);
  background: rgb(15 23 42 / 32%);
  pointer-events: none;
}

.widget-stack-host.is-stack {
  touch-action: pan-x;
}

.widget-stack-host.is-stack::after {
  inset: 9px 13px -9px;
  opacity: .55;
}

.widget-stack-stage {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--pn-radius-large, 16px);
}

.widget-stack-stage > :deep(*) {
  width: 100%;
  height: 100%;
}

.widget-stack-indicator {
  position: absolute;
  top: 50%;
  right: 8px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 4px;
  border-radius: 999px;
  background: rgb(2 6 23 / 34%);
  transform: translateY(-50%);
  backdrop-filter: blur(8px);
}

.widget-stack-dot {
  width: 6px;
  height: 6px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgb(255 255 255 / 42%);
  transition: height .18s ease, background .18s ease;
}

.widget-stack-dot.active {
  height: 14px;
  background: var(--pn-color-primary, #67e8f9);
}

.widget-stack-count {
  position: absolute;
  right: 7px;
  bottom: 6px;
  z-index: 5;
  padding: 2px 5px;
  border-radius: 999px;
  color: rgb(255 255 255 / 72%);
  background: rgb(2 6 23 / 42%);
  font-size: 9px;
  line-height: 1.2;
  pointer-events: none;
}

.widget-stack-slide-enter-active,
.widget-stack-slide-leave-active {
  transition: opacity .16s ease, transform .16s ease;
}
.widget-stack-slide-enter-from { opacity: 0; transform: translateY(14px) scale(.985); }
.widget-stack-slide-leave-to { opacity: 0; transform: translateY(-14px) scale(.985); }

@media (prefers-reduced-motion: reduce) {
  .widget-stack-slide-enter-active,
  .widget-stack-slide-leave-active { transition: none; }
}
</style>
