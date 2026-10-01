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
}>(), {
  source: 'weibo',
  limit: 10,
})

const { locale, t } = useI18n()
const widgetContext = useWidgetContext()
const trending = ref<TrendingResponse | null>(null)
const activeSource = ref<TrendingSource>(props.source)
const loading = ref(false)
const failed = ref(false)
let requestController: AbortController | null = null

const sourceLabel = computed(() => t(`trending.sources.${activeSource.value}`))
const showSourceTabs = computed(() => (widgetContext?.size.columns ?? 4) >= 3 && (widgetContext?.size.rows ?? 2) >= 2)
const sourceTabs: TrendingSource[] = ['weibo', 'baidu', 'zhihu', 'hackernews']
const sourceIcons: Partial<Record<TrendingSource, string>> = { weibo: weiboIcon, baidu: baiduIcon, zhihu: zhihuIcon }

const displayItems = computed<TrendingItem[]>(() => trending.value?.items.slice(0, props.limit) ?? [])

function formatScore(score?: number) {
  if (!score || score <= 0)
    return ''
  if (score >= 100000000)
    return `${(score / 100000000).toFixed(1)}亿`
  if (score >= 10000)
    return `${(score / 10000).toFixed(score >= 1000000 ? 0 : 1)}万`
  return String(score)
}

async function refresh() {
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  loading.value = true
  failed.value = false
  try {
    const response = await getTrending(activeSource.value, props.limit, controller.signal)
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

watch(() => props.source, value => { activeSource.value = value })
watch(activeSource, () => { trending.value = null })
watch([activeSource, () => props.limit, locale], refresh, { immediate: true })
const refreshTimer = window.setInterval(refresh, 5 * 60 * 1000)

onUnmounted(() => {
  requestController?.abort()
  window.clearInterval(refreshTimer)
})
</script>

<template>
  <section class="trending-card" :aria-label="t('trending.title')">
    <header class="trending-header">
      <img v-if="sourceIcons[activeSource]" class="trending-brand" :src="sourceIcons[activeSource]" alt="">
      <span v-else class="trending-brand trending-brand-letter" aria-hidden="true">Y</span>
      <h3 class="trending-title">
        {{ sourceLabel }}
      </h3>
      <span v-if="trending?.stale" class="trending-stale">{{ t('trending.stale') }}</span>
      <button class="trending-refresh" type="button" :disabled="loading" :title="t('trending.refresh')" @click="refresh">
        <span aria-hidden="true">↻</span>
        <span class="sr-only">{{ t('trending.refresh') }}</span>
      </button>
    </header>
    <div v-if="showSourceTabs" class="trending-sources" role="group" :aria-label="t('trending.selectSource')">
      <button v-for="sourceOption in sourceTabs" :key="sourceOption" type="button" :class="{ active: activeSource === sourceOption }" :aria-pressed="activeSource === sourceOption" @click="activeSource = sourceOption">
        {{ t(`trending.sources.${sourceOption}`) }}
      </button>
    </div>
    <ol v-if="displayItems.length" class="trending-list">
      <li v-for="item in displayItems" :key="item.rank">
        <span class="trending-rank" :class="{ 'trending-rank-top': item.rank <= 3 }">{{ item.rank }}</span>
        <a class="trending-item" :href="item.url" target="_blank" rel="noopener noreferrer" :title="item.title">
          {{ item.title }}
        </a>
        <span v-if="formatScore(item.score)" class="trending-score">{{ formatScore(item.score) }}</span>
      </li>
    </ol>
    <div v-else class="trending-placeholder">
      <span aria-hidden="true">{{ failed ? '⚠️' : '🔥' }}</span>
      <span>{{ failed ? t('trending.unavailable') : t('trending.loading') }}</span>
    </div>
  </section>
</template>

<style scoped>
.trending-card {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 12px;
  border: 1px solid var(--pn-widget-border, rgb(255 255 255 / 16%));
  border-radius: var(--pn-radius-large, 16px);
  color: var(--pn-widget-text-color, white);
  background: var(--pn-widget-background, rgb(18 25 39 / 42%));
  box-shadow: var(--pn-widget-shadow, 0 10px 30px rgb(0 0 0 / 14%));
  backdrop-filter: blur(var(--pn-effect-blur, 14px));
  text-shadow: none;
}

.trending-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex: none;
}

.trending-brand { flex: none; width: 24px; height: 24px; object-fit: contain; border-radius: 7px; }
.trending-brand-letter { display: grid; place-items: center; background: #ff6600; color: white; font-size: 14px; font-weight: 600; }

.trending-sources { display: flex; flex: none; gap: 4px; min-width: 0; overflow-x: auto; margin: 0 0 8px; padding: 3px; border-radius: 9px; background: var(--pn-widget-retry-background, rgb(255 255 255 / 6%)); }
.trending-sources button { flex: 1; padding: 4px 6px; border: 0; border-radius: 6px; color: var(--pn-widget-muted-text, rgb(255 255 255 / 72%)); background: transparent; cursor: pointer; font: inherit; font-size: 11px; white-space: nowrap; }
.trending-sources button.active, .trending-sources button:hover { color: var(--pn-widget-text-color, white); background: var(--pn-widget-border, rgb(255 255 255 / 14%)); }

.trending-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}

.trending-stale {
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--pn-notification-warning-color, #fcd34d);
  background: rgb(252 211 77 / 14%);
  font-size: 10px;
  line-height: 1.2;
}

.trending-refresh {
  margin-left: auto;
  padding: 2px 4px;
  color: var(--pn-widget-muted-text, rgb(255 255 255 / 72%));
  border: 0;
  background: transparent;
  cursor: pointer;
}

.trending-refresh:disabled {
  cursor: wait;
  opacity: .45;
}

.trending-list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--pn-widget-border) transparent;
  align-content: start;
}

.trending-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 4px 0;
}

.trending-rank {
  flex: none;
  width: 17px;
  color: var(--pn-widget-muted-text, rgb(255 255 255 / 55%));
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
  text-align: center;
}

.trending-rank-top {
  color: var(--pn-widget-chart-color-0, var(--pn-color-danger, #fca5a5));
}

.trending-item {
  flex: 1;
  overflow: hidden;
  color: var(--pn-widget-text-color, rgb(255 255 255 / 92%));
  font-size: 13px;
  line-height: 1.45;
  text-decoration: none;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.trending-item:hover {
  color: var(--pn-color-accent, white);
  text-decoration: underline;
}

.trending-score {
  flex: none;
  color: var(--pn-widget-muted-text, rgb(255 255 255 / 45%));
  font-size: 11px;
}

.trending-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 0 6px;
  color: var(--pn-widget-error-color, rgb(255 255 255 / 75%));
  font-size: 12px;
  flex: 1;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@container (min-width: 660px) {
  .trending-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 22px;
  }
}

.trending-refresh:focus-visible, .trending-sources button:focus-visible, .trending-item:focus-visible { outline: 2px solid var(--pn-widget-text-color); outline-offset: 2px; }
</style>
