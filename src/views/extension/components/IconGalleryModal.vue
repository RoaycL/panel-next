<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NModal, NSelect } from 'naive-ui'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import ItemIcon from '@/components/common/ItemIcon/index.vue'
import { ICON_PRESETS, createPresetIcon } from '@/icons/presets'
import type { IconPreset, IconPresetCategory } from '@/icons/presets'

const props = defineProps<{
  show: boolean
  pageId: number | null
  pages: { id: number, title: string }[]
  initialSection?: 'sites' | 'widgets'
  canAdd: boolean
  addedCounts?: Record<string, number>
  busy?: boolean
}>()
const emit = defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'update:pageId', value: number): void
  (event: 'done', item: Panel.Info, meta: { queued: boolean, conflict: boolean, keepOpen: boolean }): void
  (event: 'addWidget', type: string): void
  (event: 'login'): void
}>()
const WidgetGallery = defineAsyncComponent(() => import('./WidgetGalleryModal.vue'))
const EditItem = defineAsyncComponent(() => import('@/views/home/components/EditItem/index.vue'))
type Section = 'widgets' | 'sites' | 'custom'
type Category = 'all' | IconPresetCategory
const { t } = useI18n()
const editingBusy = ref(false)
const busy = computed(() => props.busy || editingBusy.value)
const visible = computed({ get: () => props.show, set: (value) => { if (!busy.value) emit('update:show', value) } })
const section = ref<Section>('sites')
const query = ref('')
const category = ref<Category>('all')
const seed = ref<Panel.Info | null>(null)
const sections = computed(() => [
  { id: 'widgets' as const, title: t('iconGallery.widgets'), icon: 'material-symbols-dashboard-customize-outline-rounded' },
  { id: 'sites' as const, title: t('iconGallery.sites'), icon: 'mdi-web' },
  { id: 'custom' as const, title: t('iconGallery.custom'), icon: 'mdi-pencil' },
])
const categories: Category[] = ['all', 'popular', 'development', 'productivity', 'social', 'entertainment']
const pageOptions = computed(() => props.pages.map(page => ({ label: page.title, value: page.id })))
const pageName = computed(() => props.pages.find(page => page.id === props.pageId)?.title)
const filtered = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return ICON_PRESETS.filter(item => (category.value === 'all' || item.category === category.value)
    && (!keyword || `${item.title} ${item.url} ${item.mark}`.toLocaleLowerCase().includes(keyword)))
})
watch(() => props.show, (show) => {
  if (show) {
    section.value = props.initialSection || 'sites'
    seed.value = null
    query.value = ''
    category.value = 'all'
  }
}, { immediate: true })
function switchSection(next: Section) {
  if (busy.value) return
  section.value = next
  query.value = ''
}
function choose(preset: IconPreset) {
  if (!props.canAdd || busy.value || props.pageId === null) return
  seed.value = { title: preset.title, url: preset.url, description: '', lanUrl: '', openMethod: 2, itemIconGroupId: props.pageId, icon: createPresetIcon(preset) }
  switchSection('custom')
}
function done(item: Panel.Info, meta: { queued: boolean, conflict: boolean, keepOpen: boolean }) {
  emit('done', item, meta)
  if (meta.keepOpen) seed.value = null
  else emit('update:show', false)
}
function host(url: string) { return new URL(url).hostname.replace(/^www\./, '') }
</script>

<template>
  <NModal v-model:show="visible" to=".pn-theme-root" preset="card" class="icon-gallery-modal" :title="t('iconGallery.title')" :closable="!busy" :mask-closable="!busy" :close-on-esc="!busy" style="width: min(1160px, calc(100vw - 24px)); max-height: calc(100dvh - 24px);">
    <div class="icon-gallery-layout">
      <aside class="icon-gallery-sidebar" :aria-label="t('iconGallery.categoryLabel')">
        <p>{{ t('iconGallery.explore') }}</p>
        <button v-for="item in sections" :key="item.id" type="button" :class="{ active: section === item.id }" :disabled="busy" :aria-pressed="section === item.id" @click="switchSection(item.id)">
          <SvgIcon :icon="item.icon" /><span>{{ item.title }}</span>
        </button>
        <span class="icon-gallery-sidebar-foot">{{ t('iconGallery.tip') }}</span>
      </aside>
      <div class="icon-gallery-main">
        <div class="icon-gallery-toolbar">
          <label v-if="section !== 'custom'" class="icon-gallery-search">
            <SvgIcon icon="material-symbols-search-rounded" />
            <input v-model="query" type="search" :placeholder="t('iconGallery.searchAll')" :aria-label="t('iconGallery.searchAll')" @input="category = 'all'">
          </label>
          <div v-else class="icon-gallery-custom-heading">
            <strong>{{ t('iconGallery.custom') }}</strong><small>{{ t('iconGallery.customHint') }}</small>
          </div>
          <label class="icon-gallery-page"><span>{{ t('iconGallery.target') }}</span><NSelect :value="pageId" :options="pageOptions" :disabled="busy" size="small" @update:value="emit('update:pageId', $event)" /></label>
        </div>
        <div v-if="!canAdd && section !== 'widgets'" class="icon-gallery-login" role="status">
          <span>{{ t('iconGallery.loginHint') }}</span><button type="button" @click="emit('login')">
            {{ t('iconGallery.login') }}
          </button>
        </div>
        <WidgetGallery v-if="section === 'widgets'" embedded :show="show" :page-name="pageName" :search-query="query" :added-counts="addedCounts" :busy="busy" @add="emit('addWidget', $event)" />
        <template v-else-if="section === 'sites'">
          <div class="icon-gallery-categories" :aria-label="t('iconGallery.categoryLabel')">
            <button v-for="item in categories" :key="item" type="button" :class="{ active: category === item }" :aria-pressed="category === item" @click="category = item">
              {{ t(`iconGallery.categories.${item}`) }}
            </button>
          </div>
          <div class="icon-gallery-heading">
            <strong>{{ t(`iconGallery.categories.${category}`) }}</strong><small>{{ t('iconGallery.results', { count: filtered.length }) }}</small>
          </div>
          <div v-if="filtered.length" class="icon-gallery-grid">
            <article v-for="preset in filtered" :key="preset.id" class="icon-gallery-tile">
              <ItemIcon :item-icon="createPresetIcon(preset)" :site-url="preset.url" :fallback-text="preset.title" :size="60" />
              <div class="icon-gallery-copy">
                <strong>{{ preset.title }}</strong><small>{{ host(preset.url) }}</small><button type="button" :disabled="!canAdd || busy || pageId === null" :aria-label="t('iconGallery.choose', { title: preset.title })" @click="choose(preset)">
                  {{ t('common.add') }}<SvgIcon icon="material-symbols-add-rounded" />
                </button>
              </div>
            </article>
          </div>
          <div v-else class="icon-gallery-empty">
            <SvgIcon icon="material-symbols-search-off-rounded" /><strong>{{ t('iconGallery.empty') }}</strong><button type="button" @click="query = ''; category = 'all'">
              {{ t('iconGallery.clearFilters') }}
            </button>
          </div>
        </template>
        <div v-else-if="canAdd && pageId !== null" class="icon-gallery-editor">
          <EditItem embedded :visible="show" :item-info="seed" :item-group-id="pageId" @busy="editingBusy = $event" @done="done" />
        </div>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
:global(.icon-gallery-modal) { overflow: hidden; border: 1px solid var(--pn-glass-border); border-radius: 20px !important; box-shadow: var(--pn-effect-shadow-high); }
:global(.icon-gallery-modal .n-card-header) { padding: 16px 22px; border-bottom: 1px solid var(--pn-glass-border); }
:global(.icon-gallery-modal .n-card__content), :global(.icon-gallery-modal .n-card-content) { padding: 0 !important; }
.icon-gallery-layout { display: grid; grid-template-columns: 176px minmax(0, 1fr); height: min(680px, calc(100dvh - 100px)); min-height: 250px; color: var(--pn-color-text-primary); }
.icon-gallery-sidebar { display: flex; flex-direction: column; gap: 7px; min-width: 0; padding: 24px 12px; border-right: 1px solid var(--pn-glass-border); background: var(--pn-glass-panel); }
.icon-gallery-sidebar p { margin: 0 10px 12px; color: var(--pn-color-text-muted); font-size: 11px; }
.icon-gallery-sidebar button { display: flex; align-items: center; gap: 12px; min-height: 46px; padding: 10px 12px; border: 0; border-radius: 12px; color: var(--pn-color-text-secondary); background: transparent; cursor: pointer; font: inherit; font-size: 14px; text-align: left; }
.icon-gallery-sidebar svg { width: 20px; height: 20px; flex: none; }
.icon-gallery-sidebar button:hover, .icon-gallery-sidebar button.active { color: var(--pn-color-text-primary); background: color-mix(in srgb, var(--pn-color-accent) 13%, transparent); }
.icon-gallery-sidebar button.active { box-shadow: none; font-weight: 700; }
.icon-gallery-sidebar-foot { margin: auto 10px 0; color: var(--pn-color-text-muted); font-size: 11px; line-height: 1.7; }
.icon-gallery-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; min-height: 0; padding: 20px; }
.icon-gallery-toolbar { display: flex; align-items: center; gap: 16px; }
.icon-gallery-search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 38px; padding: 0 12px; border: 1px solid var(--pn-glass-border); border-radius: 12px; background: var(--pn-glass-panel); }
.icon-gallery-search svg { width: 17px; height: 17px; color: var(--pn-color-text-muted); flex: none; }
.icon-gallery-search input { flex: 1; width: 0; border: 0; outline: none; color: inherit; background: transparent; font: inherit; font-size: 13px; }
.icon-gallery-search input::placeholder { color: var(--pn-color-text-muted); }
.icon-gallery-search:focus-within { border-color: var(--pn-color-accent); }
.icon-gallery-page { display: flex; align-items: center; gap: 8px; flex: none; font-size: 12px; color: var(--pn-color-text-secondary); }
.icon-gallery-page > span { white-space: nowrap; }
.icon-gallery-page :deep(.n-select) { width: 145px; }
.icon-gallery-custom-heading { display: flex; flex: 1; flex-direction: column; gap: 4px; }
.icon-gallery-custom-heading strong { font-size: 19px; }
.icon-gallery-custom-heading small { font-size: 12px; color: var(--pn-color-text-muted); }
.icon-gallery-login { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 12px; color: var(--pn-color-text-secondary); background: var(--pn-glass-panel); font-size: 12px; }
.icon-gallery-login button, .icon-gallery-empty button { flex: none; border: 0; color: var(--pn-color-accent); background: transparent; cursor: pointer; font: inherit; font-weight: 650; }
.icon-gallery-categories { display: flex; flex-wrap: wrap; gap: 7px; }
.icon-gallery-categories button { border: 0; padding: 5px 12px; border-radius: 20px; color: var(--pn-color-text-secondary); background: var(--pn-glass-panel); cursor: pointer; font: inherit; font-size: 12px; }
.icon-gallery-categories button.active { color: var(--pn-color-surface); background: var(--pn-color-accent); }
.icon-gallery-heading { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.icon-gallery-heading small { color: var(--pn-color-text-muted); font-size: 12px; }
.icon-gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: max-content; align-content: start; gap: 14px; min-height: 0; overflow: auto; padding: 2px 3px 8px; }
.icon-gallery-tile { display: flex; align-items: flex-start; gap: 12px; min-width: 0; min-height: 135px; padding: 16px 14px; border: 1px solid var(--pn-glass-border); border-radius: 18px; background: var(--pn-glass-panel); box-shadow: var(--pn-glass-highlight); }
.icon-gallery-tile :deep(.item-icon) { flex: none; box-shadow: 0 5px 16px rgb(2 6 23 / 10%); border-radius: 16px; }
.icon-gallery-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 6px; }
.icon-gallery-copy strong { overflow: hidden; font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.icon-gallery-copy small { overflow: hidden; color: var(--pn-color-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.icon-gallery-copy button { display: flex; align-items: center; justify-content: center; gap: 3px; align-self: flex-end; margin-top: 8px; padding: 5px 12px; border: 0; border-radius: 16px; color: var(--pn-color-text-primary); background: color-mix(in srgb, var(--pn-color-accent) 12%, transparent); cursor: pointer; font: inherit; font-size: 12px; }
.icon-gallery-copy button:hover:not(:disabled) { color: var(--pn-color-surface); background: var(--pn-color-accent); }
.icon-gallery-copy svg { width: 14px; height: 14px; }
button:disabled { cursor: not-allowed; opacity: .55; }
button:focus-visible { outline: 2px solid var(--pn-color-accent); outline-offset: 3px; }
.icon-gallery-empty { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; flex: 1; color: var(--pn-color-text-secondary); }
.icon-gallery-empty > svg { width: 32px; height: 32px; }
.icon-gallery-editor { flex: 1; min-height: 0; overflow: auto; padding: 2px 3px 6px; }
.icon-gallery-main > :deep(.widget-gallery-embedded) { flex: 1; min-height: 0; }
@media (max-width: 960px) { .icon-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) {
  .icon-gallery-layout { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  .icon-gallery-sidebar { flex-direction: row; gap: 5px; padding: 8px 12px; border-right: 0; border-bottom: 1px solid var(--pn-glass-border); overflow-x: auto; }
  .icon-gallery-sidebar p, .icon-gallery-sidebar-foot { display: none; }
  .icon-gallery-sidebar button { flex: none; min-height: 38px; padding: 8px 10px; gap: 7px; font-size: 12px; }
  .icon-gallery-sidebar button.active { box-shadow: inset 0 -2px var(--pn-color-accent); }
  .icon-gallery-sidebar svg { width: 17px; height: 17px; }
  .icon-gallery-main { padding: 12px; gap: 12px; }
}
@media (max-width: 540px) {
  .icon-gallery-toolbar { flex-wrap: wrap; gap: 10px; }
  .icon-gallery-search { flex-basis: 100%; }
  .icon-gallery-page { margin-left: auto; }
  .icon-gallery-grid { grid-template-columns: 1fr; gap: 10px; }
  .icon-gallery-tile { min-height: 100px; padding: 13px; }
}
</style>
