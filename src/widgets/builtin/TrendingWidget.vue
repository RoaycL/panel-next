<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TrendingItem, TrendingResponse, TrendingSource } from '@/api/trending'
import { getTrending } from '@/api/trending'

const props = withDefaults(defineProps<{
  source?: TrendingSource
  limit?: number
}>(), {
  source: 'weibo',
  limit: 10,
})

const { locale, t } = useI18n()
const trending = ref<TrendingResponse | null>(null)
const loading = ref(false)
const failed = ref(false)
let requestController: AbortController | null = null

const sourceLabel = computed(() => t(`trending.sources.${props.source}`))

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
  requestController = new AbortController()
  loading.value = true
  failed.value = false
  try {
    const response = await getTrending(props.source, props.limit, requestController.signal)
    if (response.code === 0 && Array.isArray(response.data?.items) && response.data.items.length > 0)
      trending.value = response.data
    else
      failed.value = true
  }
  catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError'))
      failed.value = true
  }
  finally {
    loading.value = false
  }
}

watch([() => props.source, () => props.limit, locale], refresh, { immediate: true })
const refreshTimer = window.setInterval(refresh, 5 * 60 * 1000)

onUnmounted(() => {
  requestController?.abort()
  window.clearInterval(refreshTimer)
})
</script>

<template>
  <section class="trending-card" :aria-label="t('trending.title')">
    <header class="trending-header">
      <h3 class="trending-title">
        {{ sourceLabel }}
      </h3>
      <span v-if="trending?.stale" class="trending-stale">{{ t('trending.stale') }}</span>
      <button class="trending-refresh" type="button" :disabled="loading" :title="t('trending.refresh')" @click="refresh">
        <span aria-hidden="true">↻</span>
        <span class="sr-only">{{ t('trending.refresh') }}</span>
      </button>
    </header>
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
  width: min(100%, 640px);
  padding: 14px 16px 12px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 16px;
  color: white;
  background: rgb(18 25 39 / 42%);
  box-shadow: 0 10px 30px rgb(0 0 0 / 14%);
  backdrop-filter: blur(14px);
  text-shadow: none;
}

.trending-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.trending-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}

.trending-stale {
  padding: 2px 7px;
  border-radius: 999px;
  color: #fcd34d;
  background: rgb(252 211 77 / 14%);
  font-size: 10px;
  line-height: 1.2;
}

.trending-refresh {
  margin-left: auto;
  padding: 2px 4px;
  color: rgb(255 255 255 / 72%);
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
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 2px 22px;
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
  color: rgb(255 255 255 / 55%);
  font-size: 12px;
  font-style: italic;
  font-weight: 700;
  text-align: center;
}

.trending-rank-top {
  color: #fca5a5;
}

.trending-item {
  flex: 1;
  overflow: hidden;
  color: rgb(255 255 255 / 92%);
  font-size: 13px;
  line-height: 1.45;
  text-decoration: none;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.trending-item:hover {
  color: white;
  text-decoration: underline;
}

.trending-score {
  flex: none;
  color: rgb(255 255 255 / 45%);
  font-size: 11px;
}

.trending-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 0 6px;
  color: rgb(255 255 255 / 75%);
  font-size: 12px;
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

@media (max-width: 640px) {
  .trending-list {
    grid-template-columns: 1fr;
  }
}
</style>
