<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TrendingItem, TrendingResponse, TrendingSource } from '@/api/trending'
import { getTrending } from '@/api/trending'
import { useWidgetContext } from '@/widgets/context'
import weiboIcon from '@/assets/brand-icons/weibo.ico'
import baiduIcon from '@/assets/brand-icons/baidu.ico'
import zhihuIcon from '@/assets/brand-icons/zhihu.ico'

const props = withDefaults(defineProps<{
  source?: TrendingSource
  limit?: number
  expanded?: boolean
}>(), {
  source: 'weibo',
  limit: 10,
  expanded: false,
})

const { locale, t } = useI18n()
const widgetContext = useWidgetContext()
const trending = ref<TrendingResponse | null>(null)
const activeSource = ref<TrendingSource>(props.source)
const loading = ref(false)
const failed = ref(false)
let requestController: AbortController | null = null

const sourceTabs: TrendingSource[] = ['weibo', 'baidu', 'zhihu', 'hackernews']
const sourceIcons: Partial<Record<TrendingSource, string>> = { weibo: weiboIcon, baidu: baiduIcon, zhihu: zhihuIcon }
const boardLinks: Record<TrendingSource, string> = {
  weibo: 'https://s.weibo.com/top/summary',
  baidu: 'https://top.baidu.com/board?tab=realtime',
  zhihu: 'https://www.zhihu.com/hot',
  hackernews: 'https://news.ycombinator.com/',
}

// Like the weather widget, the layout follows the cell: one row, a 2×2 square, a wide card, or the enlarged view.
const layout = computed(() => {
  if (props.expanded)
    return 'detail'
  const size = widgetContext?.size ?? { columns: 4, rows: 2 }
  if (widgetContext?.instanceId.startsWith('header.') || size.rows < 2)
    return 'compact'
  return size.columns <= 2 ? 'small' : 'medium'
})

const items = computed<TrendingItem[]>(() => trending.value?.items ?? [])
const maxScore = computed(() => Math.max(1, ...items.value.map(item => item.score ?? 0)))
const topItems = computed(() => items.value.slice(0, 3))
const restItems = computed(() => items.value.slice(3))
const mediumItems = computed(() => items.value.slice(0, Math.min(4, Math.max(props.limit, 1))))
const sourceLabel = computed(() => t(`trending.sources.${activeSource.value}`))

const updatedLabel = computed(() => {
  const fetchedAt = trending.value?.fetchedAt ? new Date(trending.value.fetchedAt) : null
  if (!fetchedAt || Number.isNaN(fetchedAt.getTime()))
    return ''
  return t('trending.updatedAt', { time: new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }).format(fetchedAt) })
})

function formatScore(score?: number) {
  if (!score || score <= 0)
    return ''
  if (!String(locale.value).startsWith('zh'))
    return new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(score)
  if (score >= 100000000)
    return `${(score / 100000000).toFixed(1)}亿`
  if (score >= 10000)
    return `${(score / 10000).toFixed(score >= 1000000 ? 0 : 1)}万`
  return String(score)
}

function heatWidth(item: TrendingItem) {
  return `${Math.max(4, Math.round((item.score ?? 0) / maxScore.value * 100))}%`
}

// One-row cells rotate through the top headlines instead of squeezing a list in.
const tickerIndex = ref(0)
const tickerItem = computed(() => items.value.length ? items.value[tickerIndex.value % Math.min(items.value.length, 5)] : null)
const tickerTimer = window.setInterval(() => {
  if (layout.value === 'compact' && items.value.length > 1)
    tickerIndex.value = (tickerIndex.value + 1) % Math.min(items.value.length, 5)
}, 6000)

async function refresh() {
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  loading.value = true
  failed.value = false
  try {
    const response = await getTrending(activeSource.value, props.expanded ? 50 : Math.max(5, props.limit), controller.signal)
    if (requestController !== controller)
      return
    if (response.code === 0 && Array.isArray(response.data?.items) && response.data.items.length > 0)
      trending.value = response.data
    else
      failed.value = true
  }
  catch (error) {
    if (requestController === controller && !(error instanceof DOMException && error.name === 'AbortError'))
      failed.value = true
  }
  finally {
    if (requestController === controller)
      loading.value = false
  }
}

function hideImage(event: Event) {
  (event.target as HTMLElement).style.display = 'none'
}

watch(() => props.source, value => { activeSource.value = value })
watch(activeSource, () => {
  trending.value = null
  tickerIndex.value = 0
})
watch([activeSource, () => props.limit, () => props.expanded, locale], refresh, { immediate: true })
const refreshTimer = window.setInterval(refresh, 5 * 60 * 1000)

onUnmounted(() => {
  requestController?.abort()
  window.clearInterval(refreshTimer)
  window.clearInterval(tickerTimer)
})
</script>

<template>
  <section class="trending-card" :class="[`src-${activeSource}`, `is-${layout}`]" :aria-label="t('trending.title')">
    <div class="trending-glow" aria-hidden="true" />

    <!-- Source mark: the brand icon on a white tile, a letter tile for Hacker News. -->
    <template v-if="trending">
      <!-- One row: a rotating headline. -->
      <div v-if="layout === 'compact'" class="tr-compact">
        <span class="tr-mark" aria-hidden="true"><img v-if="sourceIcons[activeSource]" :src="sourceIcons[activeSource]" alt=""><b v-else>Y</b></span>
        <Transition name="tr-roll" mode="out-in">
          <a v-if="tickerItem" :key="`${activeSource}-${tickerItem.rank}`" class="tr-compact-item" :href="tickerItem.url" target="_blank" rel="noopener noreferrer" :title="tickerItem.title">
            <span class="tr-rank" :class="{ 'is-top': tickerItem.rank <= 3 }">{{ tickerItem.rank }}</span>
            <span class="tr-title">{{ tickerItem.title }}</span>
            <span v-if="tickerItem.label" class="tr-chip" :class="`chip-${tickerItem.label}`">{{ t(`trending.labels.${tickerItem.label}`) }}</span>
          </a>
        </Transition>
      </div>

      <!-- 2×2: the lead story, Apple News style. -->
      <div v-else-if="layout === 'small'" class="tr-small">
        <header class="tr-head">
          <span class="tr-mark" aria-hidden="true"><img v-if="sourceIcons[activeSource]" :src="sourceIcons[activeSource]" alt=""><b v-else>Y</b></span>
          <span class="tr-head-name">{{ t(`trending.short.${activeSource}`) }}</span>
          <span class="tr-head-rank">TOP 1</span>
        </header>
        <a v-if="items[0]" class="tr-lead" :href="items[0].url" target="_blank" rel="noopener noreferrer" :title="items[0].title">{{ items[0].title }}</a>
        <div v-if="items[0]" class="tr-lead-meta">
          <span v-if="items[0].label" class="tr-chip" :class="`chip-${items[0].label}`">{{ t(`trending.labels.${items[0].label}`) }}</span>
          <span v-if="formatScore(items[0].score)" class="tr-heat"><span class="tr-flame" aria-hidden="true" />{{ formatScore(items[0].score) }}</span>
        </div>
        <a v-if="items[1]" class="tr-next" :href="items[1].url" target="_blank" rel="noopener noreferrer" :title="items[1].title">
          <span class="tr-rank is-top">2</span>
          <span class="tr-title">{{ items[1].title }}</span>
        </a>
      </div>

      <!-- 3–4 columns: header with source switch and the top four. -->
      <div v-else-if="layout === 'medium'" class="tr-medium">
        <header class="tr-head">
          <span class="tr-mark" aria-hidden="true"><img v-if="sourceIcons[activeSource]" :src="sourceIcons[activeSource]" alt=""><b v-else>Y</b></span>
          <span class="tr-head-name"><span class="tr-name-full">{{ sourceLabel }}</span><span class="tr-name-short">{{ t(`trending.short.${activeSource}`) }}</span></span>
          <div class="tr-switch" role="group" :aria-label="t('trending.selectSource')">
            <button v-for="option in sourceTabs" :key="option" type="button" class="tr-switch-option" :class="{ active: activeSource === option }" :aria-pressed="activeSource === option" :title="t(`trending.sources.${option}`)" @click="activeSource = option">
              <img v-if="sourceIcons[option]" :src="sourceIcons[option]" alt="">
              <b v-else aria-hidden="true">Y</b>
              <span class="sr-only">{{ t(`trending.sources.${option}`) }}</span>
            </button>
          </div>
        </header>
        <ol class="tr-rows">
          <li v-for="item in mediumItems" :key="item.rank">
            <a class="tr-row" :href="item.url" target="_blank" rel="noopener noreferrer" :title="item.title">
              <span class="tr-rank" :class="{ 'is-top': item.rank <= 3 }">{{ item.rank }}</span>
              <span class="tr-title">{{ item.title }}</span>
              <span v-if="item.label" class="tr-chip" :class="`chip-${item.label}`">{{ t(`trending.labels.${item.label}`) }}</span>
              <span v-if="formatScore(item.score)" class="tr-score">{{ formatScore(item.score) }}</span>
            </a>
          </li>
        </ol>
      </div>

      <!-- Enlarged: hero, top three, then the full ranking. -->
      <div v-else class="tr-detail">
        <header class="tr-hero">
          <span class="tr-mark is-large" aria-hidden="true"><img v-if="sourceIcons[activeSource]" :src="sourceIcons[activeSource]" alt=""><b v-else>Y</b></span>
          <div class="tr-hero-text">
            <h3 class="tr-hero-title">
              {{ sourceLabel }}
            </h3>
            <span class="tr-hero-meta">
              {{ t('trending.itemCount', { count: items.length }) }}<template v-if="updatedLabel"> · {{ updatedLabel }}</template>
              <span v-if="trending.stale" class="tr-stale">· {{ t('trending.stale') }}</span>
            </span>
          </div>
          <div class="tr-segment" role="group" :aria-label="t('trending.selectSource')">
            <button v-for="option in sourceTabs" :key="option" type="button" :class="{ active: activeSource === option }" :aria-pressed="activeSource === option" @click="activeSource = option">
              <img v-if="sourceIcons[option]" :src="sourceIcons[option]" alt="">
              <b v-else aria-hidden="true">Y</b>
              {{ t(`trending.short.${option}`) }}
            </button>
          </div>
        </header>

        <section class="tr-panel tr-podium">
          <h4 class="tr-panel-title">
            {{ t('trending.topStories') }}
          </h4>
          <ol class="tr-podium-list">
            <li v-for="item in topItems" :key="item.rank">
              <a class="tr-podium-card" :class="{ 'has-image': item.image }" :href="item.url" target="_blank" rel="noopener noreferrer" :title="item.title">
                <img v-if="item.image" class="tr-podium-image" :src="item.image" alt="" loading="lazy" referrerpolicy="no-referrer" @error="hideImage">
                <span class="tr-podium-top">
                  <span class="tr-podium-rank">{{ item.rank }}</span>
                  <span v-if="item.label" class="tr-chip" :class="`chip-${item.label}`">{{ t(`trending.labels.${item.label}`) }}</span>
                </span>
                <strong class="tr-podium-title">{{ item.title }}</strong>
                <span v-if="item.desc" class="tr-podium-desc">{{ item.desc }}</span>
                <span v-if="formatScore(item.score)" class="tr-podium-heat">
                  <span class="tr-heat"><span class="tr-flame" aria-hidden="true" />{{ formatScore(item.score) }}</span>
                  <span class="tr-bar"><span class="tr-bar-fill" :style="{ width: heatWidth(item) }" /></span>
                </span>
              </a>
            </li>
          </ol>
        </section>

        <section v-if="restItems.length" class="tr-panel tr-live">
          <h4 class="tr-panel-title">
            {{ t('trending.liveList') }}
          </h4>
          <ol class="trending-list">
            <li v-for="item in restItems" :key="item.rank">
              <a class="tr-live-row" :href="item.url" target="_blank" rel="noopener noreferrer" :title="item.desc || item.title">
                <span class="tr-rank">{{ item.rank }}</span>
                <span class="tr-live-text">
                  <span class="tr-live-title">
                    <span class="tr-title">{{ item.title }}</span>
                    <span v-if="item.label" class="tr-chip" :class="`chip-${item.label}`">{{ t(`trending.labels.${item.label}`) }}</span>
                  </span>
                  <span v-if="item.desc" class="tr-live-desc">{{ item.desc }}</span>
                </span>
                <span v-if="formatScore(item.score)" class="tr-live-heat">
                  <span class="tr-score">{{ formatScore(item.score) }}</span>
                  <span class="tr-bar"><span class="tr-bar-fill" :style="{ width: heatWidth(item) }" /></span>
                </span>
              </a>
            </li>
          </ol>
        </section>

        <footer class="tr-footer">
          <span>{{ updatedLabel }}</span>
          <button class="tr-footer-refresh" type="button" :disabled="loading" @click="refresh">
            ↻ {{ t('trending.refresh') }}
          </button>
          <a class="tr-board-link" :href="boardLinks[activeSource]" target="_blank" rel="noopener noreferrer">{{ t('trending.openBoard') }} ›</a>
        </footer>
      </div>
    </template>

    <div v-else-if="failed" class="tr-state" role="status">
      <span class="tr-mark is-large" aria-hidden="true"><img v-if="sourceIcons[activeSource]" :src="sourceIcons[activeSource]" alt=""><b v-else>Y</b></span>
      <span>{{ t('trending.unavailable') }}</span>
      <button class="tr-retry" type="button" :disabled="loading" @click="refresh">
        {{ t('common.retry') }}
      </button>
    </div>
    <div v-else class="tr-state">
      <span class="tr-mark is-large tr-pulse" aria-hidden="true"><img v-if="sourceIcons[activeSource]" :src="sourceIcons[activeSource]" alt=""><b v-else>Y</b></span>
      <span>{{ t('trending.loading') }}</span>
    </div>

    <button v-if="layout !== 'detail' && trending" class="tr-refresh" type="button" :disabled="loading" :title="t('trending.refresh')" @click="refresh">
      <span aria-hidden="true">↻</span>
      <span class="sr-only">{{ t('trending.refresh') }}</span>
    </button>
  </section>
</template>

<style scoped>
.trending-card {
  --tr-top: #ff7b45;
  --tr-mid: #f04b3c;
  --tr-bottom: #c42a4f;
  --tr-glow: rgb(255 214 140 / 45%);
  --tr-panel: rgb(70 0 20 / 16%);
  --tr-divider: rgb(255 255 255 / 20%);
  --tr-muted: rgb(255 255 255 / 74%);
  --tr-gold: #ffe08a;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 12px 14px;
  border-radius: 18px;
  color: white;
  background: linear-gradient(160deg, var(--tr-top) 0%, var(--tr-mid) 55%, var(--tr-bottom) 100%);
  box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%));
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', sans-serif;
  text-shadow: 0 1px 2px rgb(0 0 0 / 10%);
  isolation: isolate;
}

/* Each source paints the card in its own brand colour. */
.src-baidu { --tr-top: #5b7cff; --tr-mid: #3b55e6; --tr-bottom: #2a33a8; --tr-glow: rgb(150 200 255 / 45%); --tr-panel: rgb(10 20 80 / 18%); }
.src-zhihu { --tr-top: #3a9bff; --tr-mid: #0f6cf2; --tr-bottom: #0a47b8; --tr-glow: rgb(160 225 255 / 45%); --tr-panel: rgb(0 30 90 / 18%); }
.src-hackernews { --tr-top: #ff9a3d; --tr-mid: #ff6a00; --tr-bottom: #cc4a00; --tr-glow: rgb(255 230 160 / 45%); --tr-panel: rgb(80 30 0 / 16%); }

.trending-glow { position: absolute; top: -55%; right: -30%; z-index: -1; width: 95%; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle, var(--tr-glow) 0%, transparent 65%); pointer-events: none; }

a { color: inherit; text-decoration: none; }

/* Shared pieces */
.tr-mark { display: grid; flex: none; place-items: center; width: 20px; height: 20px; overflow: hidden; border-radius: 6px; background: white; box-shadow: 0 1px 3px rgb(0 0 0 / 18%); }
.tr-mark img { width: 76%; height: 76%; object-fit: contain; }
.tr-mark b { color: #ff6600; font-size: 13px; font-weight: 800; line-height: 1; }
.tr-mark.is-large { width: 40px; height: 40px; border-radius: 11px; }
.tr-mark.is-large b { font-size: 24px; }
.tr-head { display: flex; flex: none; align-items: center; gap: 7px; min-width: 0; }
.tr-head-name { overflow: hidden; font-size: 13px; font-weight: 700; line-height: 18px; white-space: nowrap; text-overflow: ellipsis; }
.tr-rank { flex: none; width: 18px; color: var(--tr-muted); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: center; }
.tr-rank.is-top { color: var(--tr-gold); font-weight: 800; }
.tr-title { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tr-chip { flex: none; padding: 0 4px; border-radius: 4px; background: rgb(255 255 255 / 92%); font-size: 10px; font-weight: 800; line-height: 15px; text-shadow: none; }
.chip-boom { color: #d70015; }
.chip-boil { color: #e85d00; }
.chip-hot { color: #ff3b30; }
.chip-new { color: #0a84ff; }
.tr-score { flex: none; color: var(--tr-muted); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
.tr-heat { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.tr-flame { width: 9px; height: 11px; background: currentColor; clip-path: path('M4.5 0C5 2.5 9 4 9 7.2A4.5 4 0 0 1 0 7.2C0 5.4 1.2 4.2 2.2 3.4 2.2 5 3 5.6 3.6 5.6 3.2 3.6 3.6 1.6 4.5 0Z'); opacity: .9; }
.tr-bar { position: relative; display: block; height: 4px; overflow: hidden; border-radius: 2px; background: rgb(0 0 0 / 18%); }
.tr-bar-fill { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: linear-gradient(90deg, rgb(255 255 255 / 70%), var(--tr-gold)); }

/* Compact (one row / header) */
.trending-card.is-compact { justify-content: center; padding: 6px 12px; }
.tr-compact { display: flex; align-items: center; gap: 8px; min-width: 0; padding-right: 18px; }
.tr-compact-item { display: flex; flex: 1; align-items: center; gap: 6px; min-width: 0; font-size: 13px; font-weight: 600; line-height: 18px; }
.tr-compact .tr-rank { width: auto; }
.tr-compact .tr-title { display: -webkit-box; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.tr-roll-enter-active, .tr-roll-leave-active { transition: opacity .3s ease, transform .3s ease; }
.tr-roll-enter-from { opacity: 0; transform: translateY(60%); }
.tr-roll-leave-to { opacity: 0; transform: translateY(-60%); }

/* Small (2×2) */
.tr-small { display: flex; flex: 1; flex-direction: column; gap: 6px; min-height: 0; }
.tr-small .tr-head-name { font-size: 12px; }
.tr-head-rank { margin-left: auto; padding-right: 2px; color: var(--tr-gold); font-size: 10px; font-weight: 800; letter-spacing: .04em; }
.tr-lead { display: -webkit-box; overflow: hidden; font-size: clamp(14px, 9cqw, 17px); font-weight: 700; line-height: 1.32; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.tr-lead-meta { display: flex; align-items: center; gap: 6px; color: var(--tr-muted); }
.tr-next { display: flex; align-items: center; gap: 4px; min-width: 0; margin-top: auto; padding-top: 6px; border-top: 1px solid var(--tr-divider); font-size: 11.5px; font-weight: 500; line-height: 15px; }
.tr-next .tr-rank { width: auto; font-size: 11.5px; }

/* Medium (3–4 × 2) */
.tr-medium { display: flex; flex: 1; flex-direction: column; gap: 6px; min-height: 0; }
.tr-switch { display: flex; flex: none; gap: 4px; margin-left: auto; padding: 2px; border-radius: 999px; background: rgb(0 0 0 / 14%); }
.tr-switch-option { display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; opacity: .62; transition: opacity .15s ease, background .15s ease; }
.tr-switch-option img { width: 14px; height: 14px; object-fit: contain; }
.tr-switch-option b { color: white; font-size: 11px; font-weight: 800; }
.tr-switch-option:hover { opacity: 1; }
.tr-switch-option.active { background: white; opacity: 1; box-shadow: 0 1px 3px rgb(0 0 0 / 18%); }
.tr-switch-option.active b { color: #ff6600; }
.tr-rows { display: grid; flex: 1; grid-template-rows: repeat(4, minmax(0, 1fr)); margin: 0; padding: 0; list-style: none; min-height: 0; }
.tr-rows li { display: flex; min-width: 0; min-height: 0; border-top: 1px solid var(--tr-divider); }
.tr-rows li:first-child { border-top: 0; }
.tr-row { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; font-size: 13px; font-weight: 500; line-height: 18px; }
.tr-row .tr-title { flex: 1; }
.tr-row:hover .tr-title, .tr-compact-item:hover .tr-title, .tr-next:hover .tr-title, .tr-lead:hover { text-decoration: underline; text-underline-offset: 2px; }

@container (max-width: 220px) {
  .tr-compact-item { font-size: 12px; line-height: 16px; }
  .tr-compact .tr-chip { display: none; }
}

.tr-name-short { display: none; }

@container (max-width: 290px) {
  .tr-name-full { display: none; }
  .tr-name-short { display: inline; }
  .tr-row .tr-score { display: none; }
  .tr-switch { gap: 2px; }
}

/* Detail (enlarged) */
.trending-card.is-detail { display: block; overflow-y: auto; padding: 24px; border-radius: 22px; scrollbar-width: none; }
.trending-card.is-detail::-webkit-scrollbar { display: none; }
.trending-card.is-detail .trending-glow { top: -30%; right: -10%; width: 60%; }
.tr-detail { display: flex; flex-direction: column; gap: 14px; }
.tr-hero { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 2px 2px 6px; }
.tr-hero-text { display: flex; flex: 1; flex-direction: column; min-width: 160px; }
.tr-hero-title { margin: 0; font-size: 28px; font-weight: 600; line-height: 1.2; }
.tr-hero-meta { color: var(--tr-muted); font-size: 13px; line-height: 18px; }
.tr-stale { margin-left: 4px; color: var(--tr-gold); }
.tr-segment { display: flex; gap: 2px; padding: 3px; border-radius: 12px; background: rgb(0 0 0 / 16%); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 8%); }
.tr-segment button { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border: 0; border-radius: 9px; color: rgb(255 255 255 / 82%); background: transparent; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; transition: background .15s ease, color .15s ease; }
.tr-segment button img { width: 16px; height: 16px; object-fit: contain; }
.tr-segment button b { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; color: white; background: #ff6600; font-size: 11px; }
.tr-segment button:hover { color: white; background: rgb(255 255 255 / 12%); }
.tr-segment button.active { color: #1c1c1e; background: white; box-shadow: 0 2px 6px rgb(0 0 0 / 16%); text-shadow: none; }
.tr-panel { min-width: 0; padding: 10px 14px 12px; border-radius: 16px; background: var(--tr-panel); backdrop-filter: blur(18px); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 8%); }
.tr-panel-title { margin: 0 0 10px; padding-bottom: 7px; border-bottom: 1px solid var(--tr-divider); color: var(--tr-muted); font-size: 12px; font-weight: 600; line-height: 16px; letter-spacing: .02em; text-transform: uppercase; }

.tr-podium-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
.tr-podium-card { position: relative; display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 140px; overflow: hidden; padding: 12px 14px; border-radius: 14px; background: rgb(255 255 255 / 12%); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 10%); isolation: isolate; transition: background .15s ease, transform .15s ease; }
.tr-podium-card:hover { background: rgb(255 255 255 / 18%); transform: translateY(-1px); }
.tr-podium-image { position: absolute; inset: 0; z-index: -2; width: 100%; height: 100%; object-fit: cover; }
.tr-podium-card.has-image::before { position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, rgb(0 0 0 / 28%) 0%, rgb(0 0 0 / 72%) 100%); content: ''; }
.tr-podium-top { display: flex; align-items: center; gap: 8px; }
.tr-podium-rank { color: var(--tr-gold); font-size: 40px; font-weight: 200; line-height: 1; font-variant-numeric: tabular-nums; }
.tr-podium-title { display: -webkit-box; overflow: hidden; font-size: 17px; font-weight: 600; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.tr-podium-desc { display: -webkit-box; overflow: hidden; color: var(--tr-muted); font-size: 12.5px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.tr-podium-heat { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; margin-top: auto; }

.trending-list { display: grid; grid-template-columns: minmax(0, 1fr); column-gap: 28px; margin: 0; padding: 0; list-style: none; }
.trending-list li { min-width: 0; border-top: 1px solid var(--tr-divider); }
.trending-list li:first-child { border-top: 0; }
.tr-live-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) 76px; align-items: center; gap: 10px; min-height: 46px; padding: 6px 4px; border-radius: 10px; }
.tr-live-row:hover { background: rgb(255 255 255 / 10%); }
.tr-live-row .tr-rank { width: auto; font-size: 15px; }
.tr-live-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.tr-live-title { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 15px; font-weight: 500; line-height: 21px; }
.tr-live-desc { overflow: hidden; color: var(--tr-muted); font-size: 12px; line-height: 16px; white-space: nowrap; text-overflow: ellipsis; }
.tr-live-heat { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.tr-live-heat .tr-bar { width: 100%; }

@container (min-width: 660px) {
  .trending-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .trending-list li:nth-child(2) { border-top: 0; }
}

.tr-footer { display: flex; align-items: center; gap: 14px; padding: 2px 4px 0; color: var(--tr-muted); font-size: 12px; }
.tr-footer-refresh { padding: 3px 10px; border: 1px solid rgb(255 255 255 / 25%); border-radius: 999px; color: inherit; background: rgb(255 255 255 / 10%); cursor: pointer; font: inherit; }
.tr-footer-refresh:hover:not(:disabled) { color: white; background: rgb(255 255 255 / 18%); }
.tr-footer-refresh:disabled { cursor: wait; opacity: .5; }
.tr-board-link { margin-left: auto; }
.tr-board-link:hover { color: white; text-decoration: underline; }

@container (max-width: 760px) {
  .trending-card.is-detail { padding: 18px 14px; }
  .tr-hero-title { font-size: 22px; }
  .tr-segment { width: 100%; }
  .tr-segment button { flex: 1; justify-content: center; padding: 6px 4px; }
  .tr-podium-list { grid-template-columns: minmax(0, 1fr); }
  .tr-podium-card { min-height: 0; }
}

/* States and controls */
.tr-state { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 0; font-size: 12px; line-height: 16px; text-align: center; }
.is-compact .tr-state { flex-direction: row; }
.is-compact .tr-state .tr-mark.is-large { width: 20px; height: 20px; border-radius: 6px; }
.tr-pulse { animation: tr-pulse 1.4s ease-in-out infinite alternate; }
@keyframes tr-pulse { from { opacity: .55; } to { opacity: 1; } }
.tr-retry { padding: 4px 14px; border: 1px solid rgb(255 255 255 / 30%); border-radius: 999px; color: white; background: rgb(255 255 255 / 14%); cursor: pointer; font: inherit; font-size: 12px; }
.tr-retry:disabled { cursor: wait; opacity: .5; }
.tr-refresh { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; color: white; background: rgb(0 0 0 / 16%); cursor: pointer; opacity: 0; font-size: 12px; transition: opacity .15s ease; }
.is-medium > .tr-refresh { display: none; }
.trending-card:hover > .tr-refresh, .tr-refresh:focus-visible { opacity: 1; }
.tr-refresh:disabled { cursor: wait; opacity: .45; }
.trending-card a:focus-visible, .trending-card button:focus-visible { outline: 2px solid white; outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (prefers-reduced-motion: reduce) {
  .tr-roll-enter-active, .tr-roll-leave-active { transition: none; }
  .tr-pulse { animation: none; }
}
</style>
