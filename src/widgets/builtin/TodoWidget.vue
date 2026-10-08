<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStoredWidgetValue } from './useStoredWidgetValue'

interface TodoItem { id: string; text: string; done: boolean }

function isTodoList(value: unknown): value is TodoItem[] {
  return Array.isArray(value) && value.length <= 30 && value.every(item =>
    item && typeof item === 'object'
    && typeof item.id === 'string' && item.id.length <= 64
    && typeof item.text === 'string' && item.text.length <= 120
    && typeof item.done === 'boolean',
  )
}

const { t } = useI18n()
const { value: items, status, saveNow } = useStoredWidgetValue<TodoItem[]>('items', [], isTodoList)
const draft = ref('')
const remaining = computed(() => items.value.filter(item => !item.done).length)

function addItem() {
  const text = draft.value.trim()
  if (!text || items.value.length >= 30)
    return
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  items.value = [...items.value, { id, text, done: false }]
  draft.value = ''
  void saveNow()
}

function toggleItem(id: string) {
  items.value = items.value.map(item => item.id === id ? { ...item, done: !item.done } : item)
  void saveNow()
}

function removeItem(id: string) {
  items.value = items.value.filter(item => item.id !== id)
  void saveNow()
}
</script>

<template>
  <section class="todo-card" :aria-label="t('todoWidget.title')">
    <header class="todo-header">
      <div>
        <h3>{{ t('todoWidget.title') }}</h3>
        <small>{{ t('todoWidget.remaining', { count: remaining }) }}</small>
      </div>
      <small :class="{ 'is-error': status === 'error' }" role="status">{{ t(`notesWidget.${status}`) }}</small>
    </header>
    <form class="todo-form" @submit.prevent="addItem">
      <input v-model="draft" type="text" maxlength="120" :placeholder="t('todoWidget.placeholder')" :aria-label="t('todoWidget.newItem')">
      <button type="submit" :disabled="!draft.trim() || items.length >= 30" :aria-label="t('todoWidget.add')">
        +
      </button>
    </form>
    <ul v-if="items.length" class="todo-list">
      <li v-for="item in items" :key="item.id" :class="{ 'is-done': item.done }">
        <label>
          <input type="checkbox" :checked="item.done" @change="toggleItem(item.id)">
          <span :title="item.text">{{ item.text }}</span>
        </label>
        <button type="button" :aria-label="t('todoWidget.remove', { item: item.text })" @click="removeItem(item.id)">
          ×
        </button>
      </li>
    </ul>
    <p v-else class="todo-empty">
      {{ t('todoWidget.empty') }}
    </p>
  </section>
</template>

<style scoped>
.todo-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 14px 16px;
  border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%));
  border-radius: var(--pn-radius-large, 16px);
  color: var(--pn-widget-text-color, white);
  background: var(--pn-widget-background, rgb(18 25 39 / 42%));
  box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%));
  backdrop-filter: blur(var(--pn-effect-blur, 14px));
}
.todo-header { display: flex; align-items: start; justify-content: space-between; gap: 8px; }
.todo-header h3 { margin: 0; font-size: 14px; font-weight: 700; line-height: 20px; }
.todo-header small { color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 11px; }
.todo-header .is-error { color: var(--pn-widget-error-color, #fca5a5); }
.todo-form { display: flex; gap: 6px; }
.todo-form input { flex: 1; width: 0; min-width: 0; padding: 7px 9px; border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%)); border-radius: 8px; color: inherit; background: var(--pn-widget-retry-background, rgb(255 255 255 / 8%)); font: inherit; font-size: 12px; }
.todo-form input::placeholder { color: var(--pn-widget-muted-text, rgb(255 255 255 / 54%)); }
.todo-form button { width: 30px; border: 0; border-radius: 8px; color: var(--pn-color-surface, #0f172a); background: var(--pn-color-accent, #5eead4); cursor: pointer; font-size: 18px; }
.todo-form button:disabled { cursor: default; opacity: .45; }
.todo-list { flex: 1; overflow: auto; margin: 0; padding: 0; list-style: none; }
.todo-list li { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 5px 0; border-bottom: 1px solid var(--pn-widget-border, rgb(255 255 255 / 10%)); }
.todo-list label { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; cursor: pointer; }
.todo-list input { accent-color: var(--pn-color-accent, #5eead4); }
.todo-list label span { overflow: hidden; min-width: 0; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.todo-list .is-done label span { opacity: .55; text-decoration: line-through; }
.todo-list li > button { flex: none; border: 0; color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); background: transparent; cursor: pointer; font-size: 17px; }
.todo-list li > button:hover { color: var(--pn-widget-error-color, #fca5a5); }
.todo-empty { margin: auto 0; color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 12px; text-align: center; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--pn-color-accent, #5eead4); outline-offset: 2px; }
</style>
