<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NModal } from 'naive-ui'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import { ICON_PRESETS } from '@/icons/presets'
import type { IconPreset, IconPresetCategory } from '@/icons/presets'

type Category = 'all' | IconPresetCategory

const props = defineProps<{
  show: boolean
  pageName?: string
  canAdd: boolean
}>()
const emit = defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'select', preset: IconPreset | null): void
  (event: 'login'): void
}>()
const { t } = useI18n()
const visible = computed({ get: () => props.show, set: value => emit('update:show', value) })
const query = ref('')
const category = ref<Category>('all')
const categories = computed(() => [
  { id: 'all', count: ICON_PRESETS.length },
  { id: 'popular', count: ICON_PRESETS.filter(item => item.category === 'popular').length },
  { id: 'development', count: ICON_PRESETS.filter(item => item.category === 'development').length },
  { id: 'productivity', count: ICON_PRESETS.filter(item => item.category === 'productivity').length },
  { id: 'social', count: ICON_PRESETS.filter(item => item.category === 'social').length },
  { id: 'entertainment', count: ICON_PRESETS.filter(item => item.category === 'entertainment').length },
] as const)
const filtered = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return ICON_PRESETS.filter(item =>
    (category.value === 'all' || item.category === category.value)
    && (!keyword || `${item.title} ${item.url} ${item.mark}`.toLocaleLowerCase().includes(keyword)),
  )
})

function resetFilters() {
  query.value = ''
  category.value = 'all'
}

function host(url: string) {
  return new URL(url).hostname.replace(/^www\./, '')
}
</script>

<template>
  <NModal
    v-model:show="visible"
    to=".pn-theme-root"
    preset="card"
    class="icon-gallery-modal"
    :title="t('iconGallery.title')"
    style="width: min(1000px, calc(100vw - 24px)); max-height: calc(100dvh - 24px);"
  >
    <div class="icon-gallery-layout">
      <aside class="icon-gallery-sidebar" :aria-label="t('iconGallery.categoryLabel')">
        <p>{{ t('iconGallery.explore') }}</p>
        <button
          v-for="item in categories"
          :key="item.id"
          type="button"
          :class="{ active: category === item.id }"
          :aria-pressed="category === item.id"
          @click="category = item.id"
        >
          <span>{{ t(`iconGallery.categories.${item.id}`) }}</span><small>{{ item.count }}</small>
        </button>
        <span class="icon-gallery-sidebar-foot">{{ t('iconGallery.tip') }}</span>
      </aside>

      <div class="icon-gallery-main">
        <div class="icon-gallery-toolbar">
          <label class="icon-gallery-search">
            <SvgIcon icon="material-symbols-search-rounded" />
            <input v-model="query" type="search" :placeholder="t('iconGallery.search')" :aria-label="t('iconGallery.search')" @input="category = 'all'">
          </label>
          <span class="icon-gallery-page">{{ t('iconGallery.addTo', { page: pageName || t('widgetGallery.currentPage') }) }}</span>
        </div>

        <div v-if="!canAdd" class="icon-gallery-login" role="status">
          <span>{{ t('iconGallery.loginHint') }}</span>
          <button type="button" @click="emit('login')">
            {{ t('iconGallery.login') }}
          </button>
        </div>

        <button type="button" class="icon-gallery-custom" :disabled="!canAdd" @click="emit('select', null)">
          <span class="icon-gallery-custom-mark"><SvgIcon icon="material-symbols-add-rounded" /></span>
          <span class="icon-gallery-custom-copy"><strong>{{ t('iconGallery.custom') }}</strong><small>{{ t('iconGallery.customHint') }}</small></span>
          <SvgIcon icon="mdi-chevron-right" class="icon-gallery-custom-chevron" />
        </button>

        <div class="icon-gallery-heading">
          <span>{{ t(`iconGallery.categories.${category}`) }}</span>
          <small>{{ t('iconGallery.results', { count: filtered.length }) }}</small>
        </div>

        <div v-if="filtered.length" class="icon-gallery-grid">
          <button
            v-for="preset in filtered"
            :key="preset.id"
            type="button"
            class="icon-gallery-tile"
            :disabled="!canAdd"
            :aria-label="t('iconGallery.choose', { title: preset.title })"
            @click="emit('select', preset)"
          >
            <span class="icon-gallery-art" :class="{ 'is-light': preset.id === 'google' }" :style="{ backgroundColor: preset.color }">
              <SvgIcon v-if="preset.sprite" :icon="preset.sprite" />
              <span v-else>{{ preset.mark }}</span>
            </span>
            <strong>{{ preset.title }}</strong>
            <small>{{ host(preset.url) }}</small>
          </button>
        </div>
        <div v-else class="icon-gallery-empty">
          <SvgIcon icon="material-symbols-search-off-rounded" />
          <strong>{{ t('iconGallery.empty') }}</strong>
          <button type="button" @click="resetFilters">
            {{ t('iconGallery.clearFilters') }}
          </button>
        </div>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
:global(.icon-gallery-modal) { overflow: hidden; border: 1px solid var(--pn-color-border, rgb(148 163 184 / 22%)); border-radius: 22px !important; box-shadow: 0 28px 84px rgb(2 6 23 / 28%); }
:global(.icon-gallery-modal .n-card-header) { padding: 16px 22px; border-bottom: 1px solid var(--pn-color-border, rgb(148 163 184 / 20%)); }
:global(.icon-gallery-modal .n-card__content) { padding: 0 !important; }
.icon-gallery-layout { display: grid; grid-template-columns: 180px minmax(0, 1fr); height: min(630px, calc(100dvh - 96px)); min-height: 300px; color: var(--pn-color-text-primary, #172033); }
.icon-gallery-sidebar { display: flex; flex-direction: column; gap: 5px; min-width: 0; padding: 22px 12px; border-right: 1px solid var(--pn-color-border, rgb(148 163 184 / 20%)); background: linear-gradient(160deg, color-mix(in srgb, var(--pn-color-accent, #0f9f75) 7%, transparent), transparent 48%), var(--pn-color-surface-hover, rgb(148 163 184 / 6%)); }
.icon-gallery-sidebar p { margin: 0 10px 9px; color: var(--pn-color-text-muted, #64748b); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.icon-gallery-sidebar button { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 10px; border: 0; border-radius: 11px; color: var(--pn-color-text-secondary, #475569); background: transparent; cursor: pointer; text-align: left; font: inherit; font-size: 13px; }
.icon-gallery-sidebar button span { flex: 1; white-space: nowrap; }
.icon-gallery-sidebar button small { color: var(--pn-color-text-muted, #64748b); font-size: 11px; }
.icon-gallery-sidebar button:hover, .icon-gallery-sidebar button.active { color: var(--pn-color-accent, #0f9f75); background: color-mix(in srgb, var(--pn-color-accent, #0f9f75) 12%, transparent); }
.icon-gallery-sidebar button.active { box-shadow: inset 3px 0 var(--pn-color-accent, #0f9f75); font-weight: 700; }
.icon-gallery-sidebar-foot { margin: auto 9px 0; color: var(--pn-color-text-muted, #64748b); font-size: 11px; line-height: 1.5; }
.icon-gallery-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 18px 20px 20px; }
.icon-gallery-toolbar { display: flex; align-items: center; gap: 10px; }
.icon-gallery-search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 40px; padding: 0 11px; border: 1px solid var(--pn-color-border, rgb(148 163 184 / 30%)); border-radius: 11px; background: var(--pn-color-surface, #fff); }
.icon-gallery-search svg { width: 17px; height: 17px; color: var(--pn-color-text-muted, #64748b); }
.icon-gallery-search input { flex: 1; width: 0; border: 0; outline: none; color: inherit; background: transparent; font: inherit; font-size: 13px; }
.icon-gallery-search input::placeholder { color: var(--pn-color-text-muted, #64748b); }
.icon-gallery-search:focus-within { border-color: var(--pn-color-accent, #0f9f75); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pn-color-accent, #0f9f75) 15%, transparent); }
.icon-gallery-page { overflow: hidden; max-width: 180px; padding: 8px 10px; border-radius: 9px; color: var(--pn-color-text-secondary, #475569); background: var(--pn-color-surface-hover, rgb(148 163 184 / 10%)); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.icon-gallery-login { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding: 9px 12px; border-radius: 10px; color: var(--pn-color-text-secondary, #475569); background: color-mix(in srgb, var(--pn-color-accent, #0f9f75) 9%, transparent); font-size: 11px; }
.icon-gallery-login button { flex: none; border: 0; color: var(--pn-color-accent, #0f9f75); background: transparent; cursor: pointer; font: inherit; font-weight: 700; }
.icon-gallery-custom { display: flex; align-items: center; gap: 12px; min-height: 66px; margin-top: 14px; padding: 10px 13px; border: 1px dashed color-mix(in srgb, var(--pn-color-accent, #0f9f75) 45%, transparent); border-radius: 14px; color: inherit; background: color-mix(in srgb, var(--pn-color-accent, #0f9f75) 7%, transparent); cursor: pointer; text-align: left; font: inherit; }
.icon-gallery-custom:hover:not(:disabled) { border-style: solid; background: color-mix(in srgb, var(--pn-color-accent, #0f9f75) 12%, transparent); }
.icon-gallery-custom:disabled, .icon-gallery-tile:disabled { cursor: not-allowed; opacity: .65; }
.icon-gallery-custom-mark { display: grid; flex: none; width: 42px; height: 42px; place-items: center; border-radius: 12px; color: #fff; background: var(--pn-color-accent, #0f9f75); }
.icon-gallery-custom-mark svg { width: 21px; height: 21px; }
.icon-gallery-custom-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; }
.icon-gallery-custom-copy strong { font-size: 13px; }
.icon-gallery-custom-copy small { overflow: hidden; color: var(--pn-color-text-secondary, #475569); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.icon-gallery-custom-chevron { flex: none; width: 17px; height: 17px; color: var(--pn-color-text-muted, #64748b); }
.icon-gallery-heading { display: flex; align-items: center; justify-content: space-between; margin: 20px 2px 12px; font-size: 13px; font-weight: 700; }
.icon-gallery-heading small { color: var(--pn-color-text-muted, #64748b); font-size: 11px; font-weight: 400; }
.icon-gallery-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); grid-auto-rows: max-content; align-content: start; gap: 10px; min-height: 0; overflow: auto; padding: 2px 3px 8px; }
.icon-gallery-tile { position: relative; display: flex; align-items: center; flex-direction: column; gap: 5px; min-width: 0; min-height: 123px; padding: 12px 7px 9px; border: 1px solid var(--pn-color-border, rgb(148 163 184 / 22%)); border-radius: 14px; color: inherit; background: var(--pn-color-surface, #fff); cursor: pointer; font: inherit; transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease; }
.icon-gallery-tile:hover:not(:disabled) { border-color: var(--pn-color-accent, #0f9f75); transform: translateY(-2px); box-shadow: 0 9px 24px rgb(2 6 23 / 12%); }
.icon-gallery-search, .icon-gallery-tile { background: var(--pn-glass-panel); border-color: var(--pn-glass-border); box-shadow: var(--pn-glass-highlight); }
.icon-gallery-art { display: grid; flex: none; width: 56px; height: 56px; place-items: center; overflow: hidden; border-radius: 15px; color: #fff; box-shadow: 0 5px 14px rgb(2 6 23 / 14%); font-size: 20px; font-weight: 800; letter-spacing: -.04em; }
.icon-gallery-art.is-light { color: #4285f4; border: 1px solid rgb(2 6 23 / 9%); }
.icon-gallery-art svg { width: 32px; height: 32px; }
.icon-gallery-tile strong { overflow: hidden; width: 100%; font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.icon-gallery-tile small { overflow: hidden; width: 100%; color: var(--pn-color-text-muted, #64748b); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.icon-gallery-empty { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; flex: 1; color: var(--pn-color-text-secondary, #475569); font-size: 13px; }
.icon-gallery-empty > svg { width: 30px; height: 30px; color: var(--pn-color-text-muted, #64748b); }
.icon-gallery-empty button { border: 0; color: var(--pn-color-accent, #0f9f75); background: transparent; cursor: pointer; font: inherit; font-size: 12px; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--pn-color-accent, #0f9f75); outline-offset: 2px; }
.icon-gallery-search input:focus-visible { outline: none; }
@media (max-width: 820px) { .icon-gallery-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 720px) {
  .icon-gallery-layout { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); height: min(700px, calc(100dvh - 92px)); }
  .icon-gallery-sidebar { flex-direction: row; align-items: center; gap: 5px; overflow-x: auto; padding: 8px 12px; border-right: 0; border-bottom: 1px solid var(--pn-color-border, rgb(148 163 184 / 20%)); }
  .icon-gallery-sidebar p, .icon-gallery-sidebar-foot { display: none; }
  .icon-gallery-sidebar button { flex: none; min-height: 34px; padding: 6px 9px; }
  .icon-gallery-sidebar button.active { box-shadow: inset 0 -2px var(--pn-color-accent, #0f9f75); }
  .icon-gallery-sidebar button small { display: none; }
  .icon-gallery-main { padding: 12px; }
}
@media (max-width: 540px) {
  .icon-gallery-toolbar { flex-direction: column; align-items: stretch; gap: 8px; }
  .icon-gallery-page { order: -1; max-width: 100%; width: fit-content; padding: 4px 8px; }
  .icon-gallery-search { flex: none; width: 100%; }
  .icon-gallery-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
  .icon-gallery-tile { min-height: 112px; padding: 9px 4px 7px; }
  .icon-gallery-art { width: 48px; height: 48px; border-radius: 13px; }
  .icon-gallery-art svg { width: 29px; height: 29px; }
}
@media (prefers-reduced-motion: reduce) { .icon-gallery-tile { transition: none; } }
</style>
