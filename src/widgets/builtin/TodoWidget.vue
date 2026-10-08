<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStoredWidgetValue } from './useStoredWidgetValue'

interface TodoItem { id: string; text: string; done: boolean }

defineProps<{ expanded?: boolean }>()

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
const activeItems = computed(() => items.value.filter(item => !item.done))
const doneItems = computed(() => items.value.filter(item => item.done))
const showDone = ref(true)

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
  <!-- Enlarged: a list in the spirit of Apple Reminders. -->
  <section v-if="expanded" class="todo-card todo-detail" :aria-label="t('todoWidget.title')">
    <header class="rem-header">
      <div>
        <h3 class="rem-title">
          {{ t('todoWidget.title') }}
        </h3>
        <span class="rem-subtitle">{{ t('todoWidget.progress', { done: doneItems.length, total: items.length }) }} · <span :class="{ 'is-error': status === 'error' }" role="status">{{ t(`notesWidget.${status}`) }}</span></span>
      </div>
      <strong class="rem-count">{{ remaining }}</strong>
    </header>
    <div class="rem-progress" aria-hidden="true">
      <span :style="{ width: `${items.length ? doneItems.length / items.length * 100 : 0}%` }" />
    </div>
    <div class="rem-scroll">
      <ul v-if="activeItems.length" class="rem-list">
        <li v-for="item in activeItems" :key="item.id">
          <button type="button" class="rem-check" role="checkbox" :aria-checked="false" :aria-label="item.text" @click="toggleItem(item.id)" />
          <span class="rem-text">{{ item.text }}</span>
          <button type="button" class="rem-remove" :aria-label="t('todoWidget.remove', { item: item.text })" @click="removeItem(item.id)">
            ×
          </button>
        </li>
      </ul>
      <p v-else-if="items.length" class="rem-empty">
        🎉 {{ t('todoWidget.allDone') }}
      </p>
      <p v-else class="rem-empty">
        {{ t('todoWidget.empty') }}
      </p>
      <form class="rem-add" @submit.prevent="addItem">
        <span class="rem-add-icon" aria-hidden="true">+</span>
        <input v-model="draft" type="text" maxlength="120" :placeholder="t('todoWidget.placeholder')" :aria-label="t('todoWidget.newItem')" :disabled="items.length >= 30">
      </form>
      <template v-if="doneItems.length">
        <button type="button" class="rem-done-toggle" :aria-expanded="showDone" @click="showDone = !showDone">
          <span>{{ t('todoWidget.completed', { count: doneItems.length }) }}</span>
          <span class="rem-done-action">{{ t(showDone ? 'todoWidget.hide' : 'todoWidget.show') }}</span>
        </button>
        <ul v-if="showDone" class="rem-list is-done">
          <li v-for="item in doneItems" :key="item.id">
            <button type="button" class="rem-check is-checked" role="checkbox" :aria-checked="true" :aria-label="item.text" @click="toggleItem(item.id)" />
            <span class="rem-text">{{ item.text }}</span>
            <button type="button" class="rem-remove" :aria-label="t('todoWidget.remove', { item: item.text })" @click="removeItem(item.id)">
              ×
            </button>
          </li>
        </ul>
      </template>
    </div>
  </section>
  <section v-else class="todo-card" :aria-label="t('todoWidget.title')">
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
.todo-detail { --rem-accent: var(--pn-color-accent, #0a84ff); gap: 0; padding: 26px 32px 20px; border-radius: 20px; }
.rem-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.rem-title { margin: 0; color: var(--rem-accent); font-size: 30px; font-weight: 700; line-height: 1.2; }
.rem-subtitle { color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 13px; }
.rem-subtitle .is-error { color: var(--pn-widget-error-color, #fca5a5); }
.rem-count { color: var(--rem-accent); font-size: 34px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.rem-progress { height: 4px; margin: 14px 0 6px; overflow: hidden; border-radius: 999px; background: var(--pn-widget-retry-background, rgb(255 255 255 / 10%)); }
.rem-progress span { display: block; height: 100%; border-radius: inherit; background: var(--rem-accent); transition: width .3s ease; }
.rem-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; }
.rem-scroll::-webkit-scrollbar { display: none; }
.rem-list { margin: 0; padding: 0; list-style: none; }
.rem-list li { display: flex; align-items: flex-start; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--pn-widget-border, rgb(255 255 255 / 10%)); }
.rem-check { flex: none; width: 22px; height: 22px; margin-top: 1px; padding: 0; border: 2px solid var(--pn-widget-muted-text, rgb(255 255 255 / 45%)); border-radius: 50%; background: transparent; cursor: pointer; transition: border-color .15s ease, background .15s ease; }
.rem-check:hover { border-color: var(--rem-accent); }
.rem-check.is-checked { border-color: var(--rem-accent); background: radial-gradient(circle, var(--rem-accent) 0 5.5px, transparent 6px); }
.rem-text { flex: 1; min-width: 0; font-size: 16px; line-height: 24px; overflow-wrap: anywhere; }
.rem-list.is-done .rem-text { color: var(--pn-widget-muted-text, rgb(255 255 255 / 55%)); }
.rem-remove { flex: none; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; color: var(--pn-widget-muted-text, rgb(255 255 255 / 60%)); background: transparent; cursor: pointer; opacity: 0; font-size: 18px; }
.rem-list li:hover .rem-remove, .rem-remove:focus-visible { opacity: 1; }
.rem-remove:hover { color: var(--pn-widget-error-color, #ef4444); background: var(--pn-widget-retry-background, rgb(255 255 255 / 8%)); }
.rem-add { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--pn-widget-border, rgb(255 255 255 / 10%)); }
.rem-add-icon { display: grid; flex: none; width: 22px; height: 22px; place-items: center; border-radius: 50%; color: white; background: var(--rem-accent); font-size: 17px; font-weight: 600; line-height: 1; }
.rem-add input { flex: 1; min-width: 0; padding: 0; border: 0; outline: none; color: inherit; background: transparent; font: inherit; font-size: 16px; line-height: 24px; }
.rem-add input::placeholder { color: var(--pn-widget-muted-text, rgb(255 255 255 / 50%)); }
.rem-empty { margin: 26px 0 12px; color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 15px; text-align: center; }
.rem-done-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-top: 18px; padding: 6px 0; border: 0; color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); background: transparent; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; }
.rem-done-action { color: var(--rem-accent); }
@container (max-width: 640px) { .todo-detail { padding: 18px 16px; } .rem-title { font-size: 24px; } }
button:focus-visible, input:focus-visible { outline: 2px solid var(--pn-color-accent, #5eead4); outline-offset: 2px; }
</style>
