<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStoredWidgetValue } from './useStoredWidgetValue'

const props = withDefaults(defineProps<{ title?: string }>(), { title: '' })
const { t } = useI18n()
const { value: content, status, saveNow } = useStoredWidgetValue('content', '', (value): value is string => typeof value === 'string' && value.length <= 10000)
const heading = computed(() => props.title.trim() || t('notesWidget.title'))
</script>

<template>
  <section class="notes-card" :aria-label="heading">
    <header class="notes-header">
      <h3>{{ heading }}</h3>
      <small :class="{ 'is-error': status === 'error' }" role="status">{{ t(`notesWidget.${status}`) }}</small>
    </header>
    <textarea
      v-model="content"
      :aria-label="t('notesWidget.editor')"
      :placeholder="t('notesWidget.placeholder')"
      maxlength="10000"
      spellcheck="true"
      @blur="saveNow"
    />
  </section>
</template>

<style scoped>
.notes-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
.notes-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.notes-header h3 { overflow: hidden; margin: 0; font-size: 14px; font-weight: 700; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.notes-header small { flex: none; color: var(--pn-widget-muted-text, rgb(255 255 255 / 65%)); font-size: 11px; }
.notes-header .is-error { color: var(--pn-widget-error-color, #fca5a5); }
textarea {
  flex: 1;
  width: 100%;
  min-height: 44px;
  padding: 0;
  resize: none;
  border: 0;
  outline: none;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 1.55;
}
textarea::placeholder { color: var(--pn-widget-muted-text, rgb(255 255 255 / 54%)); }
textarea:focus-visible { outline: 2px solid var(--pn-color-accent, #5eead4); outline-offset: 3px; border-radius: 2px; }
</style>
