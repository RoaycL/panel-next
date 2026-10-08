<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NModal } from 'naive-ui'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import { widgetRegistry } from '@/widgets/registry'
import { packageRevision } from '@/packages/manager'
import PackageCenterPanel from '@/packages/PackageCenterPanel.vue'

type Category = 'all' | 'information' | 'productivity' | 'time' | 'other'
type Filter = 'all' | 'local' | 'network'

interface GalleryMeta {
  category: Exclude<Category, 'all'>
  icon: string
  descriptionKey: string
}

const props = defineProps<{
  show: boolean
  pageName?: string
  addedCounts?: Record<string, number>
  busy?: boolean
  embedded?: boolean
  searchQuery?: string
}>()
const emit = defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'add', type: string): void
}>()
const { locale, t } = useI18n()

const visible = computed({ get: () => props.show, set: value => emit('update:show', value) })
const modalProps = computed(() => ({
  show: visible.value,
  'onUpdate:show': (value: boolean) => { visible.value = value },
  to: '.pn-theme-root',
  preset: 'card' as const,
  title: t('widgetGallery.title'),
}))
const query = ref('')
watch(() => props.searchQuery, (value) => { if (value !== undefined) query.value = value }, { immediate: true })
const category = ref<Category>('all')
const filter = ref<Filter>('all')
const previewNow = ref(new Date())
watch(visible, (isVisible) => {
  if (isVisible)
    previewNow.value = new Date()
})
const previewDate = computed(() => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }).format(previewNow.value))
const previewToday = computed(() => previewNow.value.getDate())
const previewDays = computed(() => {
  const now = previewNow.value
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const start = Math.min(Math.max(1, previewToday.value - 6), lastDay - 13)
  return Array.from({ length: 14 }, (_, index) => start + index)
})

const meta: Record<string, GalleryMeta> = {
  'core.weather': { category: 'information', icon: 'panel-next-weather', descriptionKey: 'weather' },
  'core.trending': { category: 'information', icon: 'panel-next-trending', descriptionKey: 'trending' },
  'core.notes': { category: 'productivity', icon: 'panel-next-note', descriptionKey: 'notes' },
  'core.todo': { category: 'productivity', icon: 'panel-next-checklist', descriptionKey: 'todo' },
  'core.calendar': { category: 'time', icon: 'panel-next-calendar', descriptionKey: 'calendar' },
  'core.countdown': { category: 'time', icon: 'panel-next-hourglass', descriptionKey: 'countdown' },
  'core.workday': { category: 'time', icon: 'panel-next-timer', descriptionKey: 'workday' },
  'core.date': { category: 'time', icon: 'panel-next-calendar', descriptionKey: 'date' },
}
const featuredOrder = ['core.weather', 'core.trending', 'core.workday', 'core.countdown', 'core.notes', 'core.todo', 'core.calendar', 'core.date']
function featuredRank(type: string) {
  const index = featuredOrder.indexOf(type)
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

const catalog = computed(() => { void packageRevision.value; return widgetRegistry.list()
  .filter(definition => (!definition.surfaces || definition.surfaces.includes('extension')) && !['core.clock', 'core.search'].includes(definition.type))
  .map(definition => ({
    type: definition.type,
    title: definition.meta?.title?.startsWith('widgetLayout.') ? t(definition.meta.title) : definition.meta?.title || definition.type,
    description: meta[definition.type]?.descriptionKey ? t(`widgetGallery.descriptions.${meta[definition.type].descriptionKey}`) : definition.meta?.description || t('widgetGallery.descriptions.default'),
    category: meta[definition.type]?.category || 'other',
    icon: meta[definition.type]?.icon || 'majesticons-applications',
    size: `${definition.size.default.columns}×${definition.size.default.rows}`,
    network: definition.capabilities?.includes('network') ?? false,
  }))
  .sort((a, b) => featuredRank(a.type) - featuredRank(b.type)) })

const categories = computed(() => [
  { id: 'all', label: t('widgetGallery.categories.all'), icon: 'majesticons-applications', count: catalog.value.length },
  { id: 'information', label: t('widgetGallery.categories.information'), icon: 'panel-next-trending', count: catalog.value.filter(item => item.category === 'information').length },
  { id: 'productivity', label: t('widgetGallery.categories.productivity'), icon: 'panel-next-checklist', count: catalog.value.filter(item => item.category === 'productivity').length },
  { id: 'time', label: t('widgetGallery.categories.time'), icon: 'material-symbols-schedule-outline-rounded', count: catalog.value.filter(item => item.category === 'time').length },
  { id: 'other', label: t('widgetGallery.categories.other'), icon: 'material-symbols-dashboard-customize-outline-rounded', count: catalog.value.filter(item => item.category === 'other').length },
].filter(item => item.id === 'all' || item.count > 0))

const filteredCatalog = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return catalog.value.filter(item =>
    (category.value === 'all' || item.category === category.value)
    && (filter.value === 'all' || (filter.value === 'network') === item.network)
    && (!keyword || `${item.title} ${item.description} ${item.type}`.toLocaleLowerCase().includes(keyword)),
  )
})

function resetFilters() {
  query.value = ''
  category.value = 'all'
  filter.value = 'all'
}

function add(type: string) {
  if (props.busy)
    return
  emit('add', type)
}
</script>

<template>
  <component
    :is="embedded ? 'div' : NModal"
    v-bind="embedded ? {} : modalProps"
    :class="embedded ? 'widget-gallery-embedded' : 'widget-gallery-modal'"
    :style="embedded ? undefined : 'width: min(1080px, calc(100vw - 24px)); max-height: calc(100dvh - 24px);'"
  >
    <div class="gallery-layout">
      <aside class="gallery-sidebar" :aria-label="t('widgetGallery.categoryLabel')">
        <p class="gallery-sidebar-label">
          {{ t('widgetGallery.explore') }}
        </p>
        <button
          v-for="item in categories"
          :key="item.id"
          type="button"
          class="gallery-category"
          :class="{ active: category === item.id }"
          :aria-pressed="category === item.id"
          @click="category = item.id as Category"
        >
          <SvgIcon :icon="item.icon" />
          <span>{{ item.label }}</span>
          <small>{{ item.count }}</small>
        </button>
        <p class="gallery-sidebar-foot">
          {{ t('widgetGallery.tip') }}
        </p>
      </aside>

      <div class="gallery-main">
        <div class="gallery-tools">
          <label class="gallery-search">
            <SvgIcon icon="material-symbols:search-rounded" />
            <input v-model="query" type="search" :aria-label="t('widgetGallery.search')" :placeholder="t('widgetGallery.search')">
          </label>
          <span class="gallery-page" :title="pageName">
            <SvgIcon icon="material-symbols-folder-outline" />
            {{ t('widgetGallery.addTo', { page: pageName || t('widgetGallery.currentPage') }) }}
          </span>
        </div>

        <div class="gallery-filters" role="group" :aria-label="t('widgetGallery.dataType')">
          <button type="button" :class="{ active: filter === 'all' }" :aria-pressed="filter === 'all'" @click="filter = 'all'">
            {{ t('widgetGallery.filters.all') }}
          </button>
          <button type="button" :class="{ active: filter === 'local' }" :aria-pressed="filter === 'local'" @click="filter = 'local'">
            {{ t('widgetGallery.filters.local') }}
          </button>
          <button type="button" :class="{ active: filter === 'network' }" :aria-pressed="filter === 'network'" @click="filter = 'network'">
            {{ t('widgetGallery.filters.network') }}
          </button>
          <span>{{ t('widgetGallery.results', { count: filteredCatalog.length }) }}</span>
        </div>

        <div v-if="filteredCatalog.length" class="gallery-grid">
          <article v-for="item in filteredCatalog" :key="item.type" class="gallery-card" :data-type="item.type">
            <div class="gallery-preview" :data-kind="item.category" aria-hidden="true">
              <span class="preview-kicker">{{ t('widgetGallery.preview') }}</span>
              <template v-if="item.type === 'core.weather'">
                <div class="preview-weather">
                  <span>⛅</span><strong>21°</strong><small>{{ t('widgetGallery.samples.weather') }}</small>
                </div>
              </template>
              <template v-else-if="item.type === 'core.trending'">
                <div class="preview-trending">
                  <b>{{ t('widgetGallery.samples.trendingTitle') }}</b><span><i>1</i> {{ t('widgetGallery.samples.trending1') }}</span><span><i>2</i> {{ t('widgetGallery.samples.trending2') }}</span><span><i>3</i> {{ t('widgetGallery.samples.trending3') }}</span>
                </div>
              </template>
              <template v-else-if="item.type === 'core.countdown'">
                <div class="preview-countdown">
                  <small>{{ t('widgetGallery.samples.countdownLabel') }}</small><strong>12</strong><span>{{ t('widgetGallery.samples.countdownDetail') }}</span>
                </div>
              </template>
              <template v-else-if="item.type === 'core.workday'">
                <div class="preview-workday">
                  <small>{{ t('widgetGallery.samples.workdayLabel') }}</small><strong>01:23:45</strong><span>{{ t('workdayWidget.until', { time: '18:00' }) }}</span>
                </div>
              </template>
              <template v-else-if="item.type === 'core.calendar'">
                <div class="preview-calendar">
                  <b>{{ previewDate }}</b><div><span v-for="day in previewDays" :key="day" :class="{ today: day === previewToday }">{{ day }}</span></div>
                </div>
              </template>
              <template v-else-if="item.type === 'core.date'">
                <div class="preview-date">
                  <strong>{{ previewToday }}</strong><span>{{ previewDate }}</span>
                </div>
              </template>
              <template v-else-if="item.type === 'core.notes'">
                <div class="preview-notes">
                  <b>{{ t('notesWidget.title') }}</b><span>{{ t('widgetGallery.samples.notes1') }}</span><span>{{ t('widgetGallery.samples.notes2') }}</span>
                </div>
              </template>
              <template v-else-if="item.type === 'core.todo'">
                <div class="preview-todo">
                  <b>{{ t('todoWidget.title') }}</b><span>☑ {{ t('widgetGallery.samples.todo1') }}</span><span>□ {{ t('widgetGallery.samples.todo2') }}</span><span>□ {{ t('widgetGallery.samples.todo3') }}</span>
                </div>
              </template>
              <template v-else>
                <div class="preview-generic">
                  <SvgIcon :icon="item.icon" /><span>{{ item.title }}</span>
                </div>
              </template>
            </div>
            <div class="gallery-card-details">
              <div class="gallery-card-title">
                <SvgIcon :icon="item.icon" /><h3>{{ item.title }}</h3>
                <small v-if="addedCounts?.[item.type]" class="gallery-added">{{ t('widgetGallery.addedCount', { count: addedCounts[item.type] }) }}</small>
              </div>
              <p>{{ item.description }}</p>
              <div class="gallery-card-footer">
                <span>{{ t('widgetGallery.size', { size: item.size }) }} · {{ t(`widgetGallery.filters.${item.network ? 'network' : 'local'}`) }}</span>
                <button type="button" :aria-label="t('widgetGallery.addNamed', { title: item.title })" :disabled="busy" :aria-busy="busy" @click="add(item.type)">
                  {{ busy ? t('widgetGallery.adding') : addedCounts?.[item.type] ? t('widgetGallery.addAgain') : t('widgetGallery.add') }}
                </button>
              </div>
            </div>
          </article>
        </div>
        <div v-else class="gallery-empty">
          <SvgIcon icon="material-symbols:search-off-rounded" />
          <strong>{{ t('widgetGallery.empty') }}</strong>
          <button type="button" @click="resetFilters">
            {{ t('widgetGallery.clearFilters') }}
          </button>
        </div>
        <!-- Installing packages is rare; keep it below the catalog so the widgets own the first screen. -->
        <details class="gallery-packages">
          <summary>
            <SvgIcon icon="material-symbols:dashboard-customize-outline-rounded" />
            <span>{{ t('widgetGallery.packagesTitle') }}</span>
            <small>{{ t('widgetGallery.packagesHint') }}</small>
          </summary>
          <PackageCenterPanel kind="plugin" />
        </details>
      </div>
    </div>
  </component>
</template>

<style scoped>
:global(.widget-gallery-modal) { overflow: hidden; border: 1px solid var(--pn-color-border, rgb(148 163 184 / 22%)); border-radius: 22px !important; box-shadow: 0 28px 84px rgb(2 6 23 / 28%); }
:global(.widget-gallery-modal .n-card-header) { padding: 16px 22px; border-bottom: 1px solid var(--pn-color-border, rgb(148 163 184 / 20%)); }
:global(.widget-gallery-modal .n-card__content) { padding: 0 !important; }
.gallery-layout { display: grid; grid-template-columns: 185px minmax(0, 1fr); height: min(650px, calc(100dvh - 100px)); min-height: 300px; color: var(--pn-color-text-primary, #172033); }
.gallery-sidebar { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 22px 12px; border-right: 1px solid var(--pn-color-border, rgb(148 163 184 / 20%)); background: linear-gradient(160deg, color-mix(in srgb, var(--pn-color-accent, #0f9f75) 7%, transparent), transparent 43%), var(--pn-color-surface-hover, rgb(148 163 184 / 6%)); }
.gallery-sidebar-label { margin: 0 10px 8px; color: var(--pn-color-text-muted, #64748b); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.gallery-category { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 8px 10px; border: 0; border-radius: 11px; color: var(--pn-color-text-secondary, #475569); background: transparent; cursor: pointer; text-align: left; font: inherit; font-size: 13px; }
.gallery-category svg { flex: none; width: 18px; height: 18px; }
.gallery-category span { flex: 1; white-space: nowrap; }
.gallery-category small { color: var(--pn-color-text-muted, #64748b); font-size: 11px; }
.gallery-category:hover, .gallery-category.active { color: var(--pn-color-accent, #0f9f75); background: color-mix(in srgb, var(--pn-color-accent, #0f9f75) 12%, transparent); }
.gallery-category.active { box-shadow: inset 3px 0 var(--pn-color-accent, #0f9f75); font-weight: 700; }
.gallery-sidebar-foot { margin: auto 9px 0; color: var(--pn-color-text-muted, #64748b); font-size: 11px; line-height: 1.5; }
.gallery-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: auto; padding: 18px 20px 20px; }
.gallery-tools { display: flex; align-items: center; gap: 10px; }
.gallery-search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 44px; padding: 0 11px; border: 1px solid var(--pn-color-border, rgb(148 163 184 / 30%)); border-radius: 11px; background: var(--pn-color-surface, #fff); }
.gallery-search svg { width: 17px; height: 17px; color: var(--pn-color-text-muted, #64748b); }
.gallery-search input { flex: 1; width: 0; border: 0; outline: 0; color: inherit; background: transparent; font: inherit; font-size: 13px; }
.gallery-search input::placeholder { color: var(--pn-color-text-muted, #64748b); }
.gallery-search:focus-within { border-color: var(--pn-color-accent, #0f9f75); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pn-color-accent, #0f9f75) 15%, transparent); }
.gallery-search input:focus-visible { outline: none; }
.gallery-page { display: flex; align-items: center; gap: 5px; max-width: 210px; overflow: hidden; padding: 8px 10px; border-radius: 9px; color: var(--pn-color-text-secondary, #475569); background: var(--pn-color-surface-hover, rgb(148 163 184 / 10%)); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.gallery-page svg { flex: none; width: 15px; height: 15px; }
.gallery-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin: 14px 0 16px; }
.gallery-filters button { min-height: 27px; padding: 4px 11px; border: 1px solid var(--pn-color-border, rgb(148 163 184 / 22%)); border-radius: 999px; color: var(--pn-color-text-secondary, #475569); background: var(--pn-color-surface, #fff); cursor: pointer; font: inherit; font-size: 11px; }
.gallery-filters button.active { border-color: var(--pn-color-accent, #0f9f75); color: var(--pn-color-surface); background: var(--pn-color-accent, #0f9f75); }
.gallery-filters > span { margin-left: auto; color: var(--pn-color-text-muted, #64748b); font-size: 11px; }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); grid-auto-rows: max-content; align-content: start; gap: 13px; padding: 1px 2px 8px; }
.gallery-card { min-width: 0; overflow: hidden; isolation: isolate; border: 1px solid var(--pn-color-border, rgb(148 163 184 / 22%)); border-radius: 16px; background: var(--pn-color-surface, #fff); transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease; }
.gallery-card:hover { border-color: var(--pn-color-accent, #0f9f75); transform: translateY(-2px); box-shadow: 0 12px 30px rgb(2 6 23 / 12%); }
.gallery-search, .gallery-card, .gallery-filters button:not(.active) { background: var(--pn-glass-panel); border-color: var(--pn-glass-border); box-shadow: var(--pn-glass-highlight); }
.gallery-preview { position: relative; display: grid; place-items: center; height: 145px; overflow: hidden; border-radius: 15px 15px 0 0; padding: 14px 20px; color: #f8fafc; background: var(--pn-sidebar-active-background); color: var(--pn-color-text-primary); text-shadow: none; isolation: isolate; }
.preview-kicker { position: absolute; top: 11px; right: 13px; color: var(--pn-color-text-muted); font-size: 9px; font-weight: 700; letter-spacing: .08em; }
.gallery-preview > div { width: min(100%, 270px); }
.preview-weather { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 14px; }
.preview-weather > span { grid-row: span 2; font-size: 48px; }
.preview-weather strong { font-size: 33px; line-height: 1; }
.preview-weather small { color: var(--pn-color-text-secondary); font-size: 11px; }
.preview-trending, .preview-todo, .preview-notes { display: flex; flex-direction: column; gap: 6px; }
.preview-trending b, .preview-todo b, .preview-notes b { margin-bottom: 3px; font-size: 14px; }
.preview-trending span, .preview-todo span, .preview-notes span { overflow: hidden; color: var(--pn-color-text-secondary); font-size: 11px; white-space: nowrap; text-overflow: ellipsis; }
.preview-trending i { display: inline-grid; width: 19px; height: 19px; margin-right: 5px; place-items: center; border-radius: 5px; color: var(--pn-color-accent); background: var(--pn-color-surface); font-style: normal; }
.preview-countdown { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.preview-countdown small, .preview-countdown span { color: var(--pn-color-text-secondary); font-size: 11px; }
.preview-countdown strong { font-size: 56px; line-height: 1.1; }
.preview-workday { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.preview-workday small, .preview-workday span { color: var(--pn-color-text-secondary); font-size: 11px; }
.preview-workday strong { font-size: clamp(24px, 3vw, 38px); font-variant-numeric: tabular-nums; letter-spacing: -.04em; }
.preview-calendar b { display: block; margin-bottom: 9px; font-size: 14px; }
.preview-calendar > div { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center; }
.preview-calendar span { font-size: 10px; }
.preview-calendar span.today { border-radius: 6px; color: var(--pn-color-surface); background: var(--pn-color-accent); font-weight: 700; }
.preview-date { display: flex; align-items: center; justify-content: center; gap: 15px; }
.preview-date strong { font-size: 58px; line-height: 1; letter-spacing: -.07em; }
.preview-date span { max-width: 120px; font-size: 15px; font-weight: 700; line-height: 1.3; }
.preview-generic { display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 18px; font-weight: 700; }
.preview-generic svg { width: 42px; height: 42px; }
.gallery-card-details { display: flex; flex-direction: column; min-height: 105px; padding: 11px 14px 12px; }
.gallery-card-title { display: flex; align-items: center; gap: 7px; }
.gallery-card-title svg { width: 17px; height: 17px; color: var(--pn-color-accent, #0f9f75); }
.gallery-card-title h3 { margin: 0; font-size: 14px; font-weight: 750; }
.gallery-added { margin-left: auto; padding: 2px 6px; border-radius: 5px; color: var(--pn-color-accent, #0f9f75); background: color-mix(in srgb, var(--pn-color-accent, #0f9f75) 11%, transparent); font-size: 10px; white-space: nowrap; }
.gallery-card-details p { flex: 1; margin: 6px 0 10px; color: var(--pn-color-text-secondary, #475569); font-size: 12px; line-height: 1.5; }
.gallery-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gallery-card-footer span { color: var(--pn-color-text-muted, #64748b); font-size: 11px; }
.gallery-card-footer button { min-width: 70px; min-height: 40px; padding: 7px 12px; border: 0; border-radius: var(--pn-radius-medium, 12px); color: var(--pn-color-surface); background: var(--pn-color-accent, #0f9f75); cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; }
.gallery-card-footer button:hover { filter: brightness(1.07); }
.gallery-card-footer button:disabled { cursor: wait; opacity: .6; filter: none; }
.gallery-empty { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; flex: 1; color: var(--pn-color-text-secondary, #475569); font-size: 13px; }
.gallery-empty svg { width: 32px; height: 32px; color: var(--pn-color-text-muted, #64748b); }
.gallery-empty button { border: 0; color: var(--pn-color-accent, #0f9f75); background: transparent; cursor: pointer; font: inherit; font-size: 12px; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--pn-color-accent, #0f9f75); outline-offset: 2px; }
@media (max-width: 720px) {
  .gallery-layout { grid-template-columns: 1fr; height: min(700px, calc(100dvh - 92px)); }
  .gallery-sidebar { flex-direction: row; align-items: center; gap: 5px; overflow-x: auto; padding: 8px 12px; border-right: 0; border-bottom: 1px solid var(--pn-color-border, rgb(148 163 184 / 20%)); }
  .gallery-sidebar-label, .gallery-sidebar-foot { display: none; }
  .gallery-category { width: auto; flex: none; min-height: 44px; padding: 8px 10px; }
  .gallery-category.active { box-shadow: inset 0 -2px var(--pn-color-accent, #0f9f75); }
  .gallery-category small { display: none; }
  .gallery-main { padding: 12px; }
}
@media (max-width: 540px) {
  .gallery-grid { grid-template-columns: 1fr; }
  .gallery-preview { height: 120px; }
  .gallery-tools { flex-direction: column; align-items: stretch; gap: 8px; }
  .gallery-page { order: -1; max-width: 100%; width: fit-content; padding: 4px 8px; }
  .gallery-search { flex: none; width: 100%; }
  .gallery-filters > span { display: none; }
}
@media (prefers-reduced-motion: reduce) { .gallery-card { transition: none; } }
.widget-gallery-embedded { height: 100%; min-height: 0; }
.widget-gallery-embedded .gallery-layout { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.widget-gallery-embedded .gallery-sidebar { flex: none; flex-direction: row; align-items: center; gap: 6px; overflow-x: auto; padding: 0 0 10px; border: 0; background: transparent; }
.widget-gallery-embedded .gallery-sidebar-label, .widget-gallery-embedded .gallery-sidebar-foot, .widget-gallery-embedded .gallery-tools { display: none; }
.widget-gallery-embedded .gallery-category { flex: none; width: auto; min-height: 30px; padding: 5px 10px; border-radius: 999px; font-size: 12px; }
.widget-gallery-embedded .gallery-category svg { display: none; }
.widget-gallery-embedded .gallery-category.active { box-shadow: none; }
.widget-gallery-embedded .gallery-main { flex: 1; padding: 0; }
.widget-gallery-embedded .gallery-filters { margin: 0 0 12px; }
.widget-gallery-embedded .gallery-card-details { padding: 14px; }
.widget-gallery-embedded .gallery-preview { height: 120px; }
@media (max-width: 540px) { .widget-gallery-embedded .gallery-preview { height: 110px; } }
.gallery-packages { flex: none; margin-top: 14px; border: 1px solid var(--pn-glass-border, var(--pn-color-border, rgb(148 163 184 / 22%))); border-radius: 14px; background: var(--pn-glass-panel, var(--pn-color-surface, #fff)); }
.gallery-packages summary { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; cursor: pointer; color: var(--pn-color-text-secondary, #475569); font-size: 13px; font-weight: 650; list-style: none; }
.gallery-packages summary::-webkit-details-marker { display: none; }
.gallery-packages summary::after { content: '›'; margin-left: 8px; font-size: 16px; transition: transform .15s ease; }
.gallery-packages[open] summary::after { transform: rotate(90deg); }
.gallery-packages summary svg { flex: none; width: 17px; height: 17px; color: var(--pn-color-accent, #0f9f75); }
.gallery-packages summary small { margin-left: auto; color: var(--pn-color-text-muted, #64748b); font-size: 11px; font-weight: 400; }
.gallery-packages[open] { padding-bottom: 4px; }
.gallery-packages > :not(summary) { margin: 0 10px 10px; }
</style>
