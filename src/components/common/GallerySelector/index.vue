<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  NButton,
  NInput,
  NInputGroup,
  NPagination,
  NSelect,
  NSpin,
  useMessage,
} from 'naive-ui'
import { getList as getPrivateList } from '@/api/system/file'
import { getList as getPublicList } from '@/api/system/publicFile'
import { getWallhavenWallpapers   } from '@/api/wallhaven'
import type {WallhavenItem, WallhavenSearchParams} from '@/api/wallhaven';
import { SvgIcon } from '@/components/common'
import { t } from '@/locales'
import { getRuntime } from '@/runtime'
import { useAuthStore } from '@/store'
import { preloadWallpaper } from '@/runtime/wallpaperLoader'
import { MAX_WALLPAPER_FAVORITES, readWallpaperFavorites, wallpaperFavoritesKey, wallpaperIdentity, writeWallpaperFavorites } from '@/runtime/wallpaperFavorites'
import type { FavoriteWallpaper } from '@/runtime/wallpaperFavorites'

const props = withDefaults(defineProps<{
  type?: string // icon/wallpaper/other/all
}>(), {
  type: 'all',
})

const emit = defineEmits<{
  (e: 'select', url: string): void
}>()

const ms = useMessage()
const runtime = getRuntime()
const auth = useAuthStore()
const isWallpaperPicker = computed(() => props.type === 'wallpaper')
const favoritesKey = computed(() => wallpaperFavoritesKey(runtime.getServerOrigin(), auth.userInfo?.id))
const favoriteWallpapers = ref<FavoriteWallpaper[]>([])
const savingFavorite = ref(false)
watch(favoritesKey, key => { favoriteWallpapers.value = readWallpaperFavorites(runtime.storage, key, runtime.getServerOrigin()) }, { immediate: true })
const stopFavoritesSubscription = runtime.storage.subscribe?.(change => {
  if (change.scope === 'data' && change.key === favoritesKey.value && !savingFavorite.value)
    favoriteWallpapers.value = readWallpaperFavorites(runtime.storage, favoritesKey.value, runtime.getServerOrigin())
})
onBeforeUnmount(() => stopFavoritesSubscription?.())

function isFavorite(url: string) {
  const id = wallpaperIdentity(url, runtime.getServerOrigin())
  return favoriteWallpapers.value.some(item => wallpaperIdentity(item.url, runtime.getServerOrigin()) === id)
}
async function toggleFavorite(item: Omit<FavoriteWallpaper, 'savedAt'>) {
  if (savingFavorite.value) return
  const key = favoritesKey.value
  const origin = runtime.getServerOrigin()
  const current = readWallpaperFavorites(runtime.storage, key, origin)
  const id = wallpaperIdentity(item.url, origin)
  const exists = current.some(saved => wallpaperIdentity(saved.url, origin) === id)
  if (!exists && current.length >= MAX_WALLPAPER_FAVORITES) { ms.warning(`最多喜欢 ${MAX_WALLPAPER_FAVORITES} 张壁纸，请先取消一些收藏`); return }
  const next = exists ? current.filter(saved => wallpaperIdentity(saved.url, origin) !== id)
    : [{ ...item, title: item.title.slice(0, 160), savedAt: new Date().toISOString() }, ...current]
  savingFavorite.value = true
  try {
    await writeWallpaperFavorites(runtime.storage, key, next)
    if (key !== favoritesKey.value) return
    favoriteWallpapers.value = next
    ms.success(exists ? '已取消喜欢' : '已加入我的喜欢')
  }
  catch { ms.error('喜欢列表保存失败，请重试') }
  finally { savingFavorite.value = false }
}
const apiKeyStorageKey = computed(() => `WALLHAVEN_API_KEY_V1:${auth.userInfo?.id ?? 'guest'}`)
const apiKeyDraft = ref('')
const wallhavenApiKey = ref('')
const wallhavenPurity = ref('100')
watch(apiKeyStorageKey, key => {
  wallhavenApiKey.value = runtime.storage.getItem(key) || ''
  apiKeyDraft.value = wallhavenApiKey.value
  wallhavenPurity.value = '100'
}, { immediate: true })
const purityOptions = computed(() => [
  { label: 'SFW · 安全', value: '100' },
  { label: 'Sketchy · 中间级', value: '010' },
  { label: 'NSFW · 成人', value: '001', disabled: !wallhavenApiKey.value },
])
async function saveApiKey() {
  const key = apiKeyDraft.value.trim()
  const storageKey = apiKeyStorageKey.value
  if (key && !/^[a-z0-9]{16,128}$/i.test(key)) { ms.error('API Key 格式无效，请从 Wallhaven 账号设置复制'); return }
  try {
    if (key) runtime.storage.setItem(storageKey, key)
    else runtime.storage.removeItem(storageKey)
    await runtime.storage.flush?.()
  }
  catch { ms.error('API Key 本机保存失败，请重试'); return }
  if (storageKey !== apiKeyStorageKey.value) return
  wallhavenApiKey.value = key
  if (!key) wallhavenPurity.value = '100'
  ms.success(key ? 'API Key 已保存在本机' : 'API Key 已清除')
  handleWallhavenSearch()
}
let requestGeneration = 0
let selectionGeneration = 0
const selectingUrl = ref('')
const failedImages = ref(new Set<string>())
onBeforeUnmount(() => { requestGeneration++; selectionGeneration++ })
const loading = ref(false)
const source = ref<'private' | 'public' | 'wallhaven' | 'favorites'>('private')

// 1. 本地/公共图库
const imageList = ref<File.Info[]>([])
const activeType = ref<string>(props.type)

const sourceOptions = [
  { label: t('apps.uploadsFileManager.typeAll'), value: 'all' },
  { label: t('apps.uploadsFileManager.typeIcon'), value: 'icon' },
  { label: t('apps.uploadsFileManager.typeWallpaper'), value: 'wallpaper' },
  { label: t('apps.uploadsFileManager.typeOther'), value: 'other' },
]

// 2. Wallhaven 壁纸库
const wallhavenList = ref<WallhavenItem[]>([])
const wallhavenPage = ref(1)
const wallhavenTotalPages = ref(1)
const wallhavenTotal = ref(0)
const wallhavenQuery = ref('')
const wallhavenSorting = ref<'toplist' | 'hot' | 'views' | 'random' | 'date_added'>('toplist')
const wallhavenCategories = ref('110') // 110: General + Anime

const wallhavenSortingOptions = [
  { label: '最热榜单', value: 'toplist' },
  { label: '近期热门', value: 'hot' },
  { label: '最多浏览', value: 'views' },
  { label: '随机发现', value: 'random' },
  { label: '最新上传', value: 'date_added' },
]

const quickTags = [
  { label: '🌟 精选推荐', q: '', cat: '110' },
  { label: '🎨 动漫二次元', q: 'anime', cat: '010' },
  { label: '🌄 自然风光', q: 'nature landscape', cat: '100' },
  { label: '🏙️ 赛博朋克', q: 'cyberpunk', cat: '110' },
  { label: '🌌 宇宙星空', q: 'space galaxy', cat: '100' },
  { label: '💻 科技极简', q: 'minimalism tech', cat: '100' },
  { label: '🚗 顶级超跑', q: 'supercar', cat: '100' },
]

async function fetchImages() {
  if (source.value === 'favorites') { requestGeneration++; loading.value = false; return }
  if (source.value === 'wallhaven') { await fetchWallhaven(); return }
  const generation = ++requestGeneration
  const selectedSource = source.value
  loading.value = true
  imageList.value = []
  failedImages.value = new Set()
  try {
    const type = activeType.value === 'all' ? undefined : activeType.value
    const result = selectedSource === 'private'
      ? await getPrivateList<Common.ListResponse<File.Info[]>>(type)
      : await getPublicList<Common.ListResponse<File.Info[]>>(type)
    if (generation !== requestGeneration) return
    if (result.code !== 0) throw new Error(result.msg || '图库加载失败')
    imageList.value = result.data?.list || []
  }
  catch { if (generation === requestGeneration) ms.error('图库加载失败，请重试') }
  finally {
    if (generation === requestGeneration) loading.value = false
  }
}

async function fetchWallhaven() {
  const generation = ++requestGeneration
  loading.value = true
  wallhavenList.value = []
  try {
    const params: WallhavenSearchParams = {
      q: wallhavenQuery.value.trim() || undefined,
      categories: wallhavenCategories.value,
      purity: wallhavenPurity.value,
      sorting: wallhavenSorting.value,
      topRange: '1M',
      atleast: '1920x1080',
      ratios: '16x9,16x10',
      page: wallhavenPage.value,
    }
    const res = await getWallhavenWallpapers(params, wallhavenApiKey.value)
    if (generation !== requestGeneration) return
    if (res.code === 0 && res.data) {
      wallhavenList.value = res.data.items || []
      wallhavenTotalPages.value = res.data.meta.lastPage || 1
      wallhavenTotal.value = res.data.meta.total || 0
    }
    else {
      ms.error(res.msg || '获取 Wallhaven 壁纸失败')
    }
  }
  catch {
    if (generation === requestGeneration) ms.error('请求 Wallhaven 服务失败，请检查 API Key 或网络后重试')
  }
  finally {
    if (generation === requestGeneration) loading.value = false
  }
}

function handleQuickTagClick(tag: typeof quickTags[number]) {
  wallhavenQuery.value = tag.q
  wallhavenCategories.value = tag.cat
  wallhavenPage.value = 1
  void fetchWallhaven()
}

function handleWallhavenSearch() {
  wallhavenPage.value = 1
  void fetchWallhaven()
}

function handlePageChange(page: number) {
  wallhavenPage.value = page
  void fetchWallhaven()
}

async function handleSelect(url: string) {
  const generation = ++selectionGeneration
  selectingUrl.value = url
  try {
    await preloadWallpaper(runtime.resolveUrl(url))
    if (generation !== selectionGeneration) return
    emit('select', url)
    ms.success(props.type === 'wallpaper' ? '壁纸已加载并选择' : '已选择图片')
  }
  catch (error) { if (generation === selectionGeneration) ms.error(error instanceof Error ? error.message : '图片加载失败') }
  finally { if (generation === selectionGeneration) selectingUrl.value = '' }
}

watch(source, () => {
  selectionGeneration++
  selectingUrl.value = ''
  if (source.value === 'wallhaven') {
    void fetchWallhaven()
  }
  else {
    void fetchImages()
  }
})
watch(apiKeyStorageKey, () => {
  requestGeneration++
  selectionGeneration++
  selectingUrl.value = ''
  wallhavenList.value = []
  void fetchImages()
})

onMounted(() => {
  if (source.value === 'wallhaven')
    void fetchWallhaven()
  else
    void fetchImages()
})
</script>

<template>
  <div class="gallery-selector p-3 h-full overflow-auto flex flex-col">
    <!-- 顶部来源切换导航 -->
    <div class="flex items-center justify-between mb-3 gap-2 flex-wrap pb-2 border-b border-slate-200 dark:border-zinc-800">
      <div class="flex gap-2 items-center flex-wrap">
        <button v-if="isWallpaperPicker" type="button" class="source-tab-btn" :class="{ active: source === 'favorites' }" @click="source = 'favorites'">
          <SvgIcon icon="material-symbols:favorite" class="text-sm" />
          <span>我的喜欢 <small>{{ favoriteWallpapers.length }}</small></span>
        </button>
        <button
          type="button"
          class="source-tab-btn"
          :class="{ active: source === 'private' }"
          @click="source = 'private'"
        >
          <SvgIcon icon="material-symbols:folder-shared-outline" class="text-sm" />
          <span>个人图库</span>
        </button>

        <button
          type="button"
          class="source-tab-btn"
          :class="{ active: source === 'public' }"
          @click="source = 'public'"
        >
          <SvgIcon icon="material-symbols:public" class="text-sm" />
          <span>{{ $t('apps.publicGallery.appName') }}</span>
        </button>

        <button
          type="button"
          class="source-tab-btn wallhaven-tab"
          :class="{ active: source === 'wallhaven' }"
          @click="source = 'wallhaven'"
        >
          <span class="wallhaven-badge">4K</span>
          <span>Wallhaven 壁纸库</span>
        </button>
      </div>

      <!-- 本地/公共筛选 -->
      <NSelect
        v-if="source === 'private' || source === 'public'"
        v-model:value="activeType"
        :options="sourceOptions"
        size="small"
        style="width: 140px"
        @update-value="fetchImages"
      />
      <NButton v-if="source === 'private' || source === 'public'" size="small" secondary @click="fetchImages">
        刷新图库
      </NButton>
    </div>

    <!-- Wallhaven 专属快捷工具栏 -->
    <div v-if="source === 'wallhaven'" class="wallhaven-toolbar">
      <details class="wallhaven-account-settings">
        <summary>Wallhaven 账号 API Key · {{ wallhavenApiKey ? '已配置' : '未配置' }}</summary>
        <div class="wallhaven-key-controls">
          <NInput v-model:value="apiKeyDraft" type="password" show-password-on="click" placeholder="从 Wallhaven 账号设置复制 API Key" autocomplete="off" :maxlength="128" aria-label="Wallhaven API Key" />
          <NButton size="small" @click="saveApiKey">
            保存到本机
          </NButton>
          <NButton size="small" @click="apiKeyDraft = ''; saveApiKey()">
            清除
          </NButton>
        </div>
        <small>仅保存在当前浏览器和当前账号下，不随布局同步。搜索时交由你连接的 Panel Next 服务转发至 Wallhaven，不放入 URL。请使用可信的 HTTPS 服务。</small>
        <a href="https://wallhaven.cc/settings/account" target="_blank" rel="noopener noreferrer">打开 Wallhaven 账号设置</a>
      </details>
      <!-- 搜索与排序 -->
      <div class="wallhaven-search-row">
        <NInputGroup>
          <NInput
            v-model:value="wallhavenQuery"
            placeholder="搜索壁纸，发现喜欢的风景…"
            clearable
            @keydown.enter="handleWallhavenSearch"
          />
          <NButton type="primary" @click="handleWallhavenSearch">
            <template #icon>
              <SvgIcon icon="material-symbols:search-rounded" />
            </template>
            搜索
          </NButton>
        </NInputGroup>
      </div>
      <div class="wallhaven-filters">
        <label class="wallhaven-filter"><span>排序方式</span>
          <NSelect
            v-model:value="wallhavenSorting"
            :options="wallhavenSortingOptions"
            aria-label="Wallhaven 排序方式"
            @update-value="handleWallhavenSearch"
          />
        </label>
        <label class="wallhaven-filter"><span>内容分级</span>
          <NSelect v-model:value="wallhavenPurity" :options="purityOptions" aria-label="Wallhaven 内容范围" @update-value="handleWallhavenSearch" />
        </label>
        <label class="wallhaven-filter"><span>壁纸分类</span>
          <NSelect v-model:value="wallhavenCategories" :options="[{ label: '全部分类', value: '111' }, { label: '综合 + 动漫', value: '110' }, { label: '综合', value: '100' }, { label: '动漫', value: '010' }, { label: '人物', value: '001' }]" aria-label="Wallhaven 分类" @update-value="handleWallhavenSearch" />
        </label>
      </div>
      <p v-if="!wallhavenApiKey" class="wallhaven-rating-hint">NSFW 需要配置有效的 Wallhaven 账号 API Key。</p>

      <!-- 热门快捷标签 -->
      <div class="quick-tags flex items-center gap-1.5 flex-wrap">
        <button
          v-for="tag in quickTags"
          :key="tag.label"
          type="button"
          class="tag-btn"
          :class="{ active: wallhavenQuery === tag.q }"
          @click="handleQuickTagClick(tag)"
        >
          {{ tag.label }}
        </button>
      </div>
      <div v-if="wallhavenTotal > 0" class="wallhaven-results-summary">找到约 {{ wallhavenTotal }} 张壁纸 · 第 {{ wallhavenPage }} 页</div>
    </div>
    <p v-if="selectingUrl" role="status" class="gallery-selection-status">
      正在加载原图，成功后应用；期间保留当前壁纸…
    </p>

    <!-- 主体内容加载 -->
    <div v-if="loading" class="flex-1 flex items-center justify-center py-16">
      <NSpin size="medium" description="正在加载高清壁纸..." />
    </div>

    <!-- 1. 本地/公共图库网格 -->
    <div v-else-if="source === 'favorites'" class="flex-1">
      <p class="favorites-description">
        喜欢的壁纸集中在这里，点击图片即可应用。保存在当前浏览器，按账号隔离。
      </p>
      <div v-if="!favoriteWallpapers.length" class="favorites-empty">
        <SvgIcon icon="mdi:heart-outline" />
        <strong>还没有喜欢的壁纸</strong>
        <span>去图库点击壁纸右上角的爱心，即可收藏到这里。</span>
        <NButton secondary @click="source = 'wallhaven'">
          浏览壁纸库
        </NButton>
      </div>
      <div v-else class="gallery-local-grid">
        <div v-for="item in favoriteWallpapers" :key="item.url" class="gallery-item-card favorite-card">
          <button type="button" class="gallery-image-action" :aria-label="`应用壁纸：${item.title}`" @click="handleSelect(item.url)">
            <img v-if="!failedImages.has(item.thumbnail)" :src="runtime.resolveUrl(item.thumbnail)" :alt="item.title" loading="lazy" class="gallery-thumbnail" @error="failedImages.add(item.thumbnail)">
            <span v-else class="gallery-image-failure">预览加载失败，点击尝试原图</span>
          </button>
          <button type="button" class="favorite-button is-favorite" :aria-label="`取消喜欢：${item.title}`" title="取消喜欢" :aria-pressed="true" :disabled="savingFavorite" @click.stop="toggleFavorite(item)">
            <SvgIcon icon="material-symbols:favorite" />
          </button>
          <div class="favorite-card-caption">
            <span>{{ item.title }}</span><small>{{ item.source === 'wallhaven' ? 'Wallhaven' : item.source === 'public' ? '公共图库' : '个人图库' }}</small>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="source !== 'wallhaven'" class="flex-1">
      <div v-if="imageList.length === 0" class="text-center text-slate-400 py-12">
        {{ t('apps.uploadsFileManager.nothingText') }}
      </div>

      <div v-else class="gallery-local-grid">
        <div
          v-for="item in imageList" :key="item.id"
          class="gallery-item-card group cursor-pointer rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-800 hover:border-emerald-500 transition-all hover:shadow-md"
          @click="handleSelect(item.src)"
        >
          <button v-if="isWallpaperPicker && (item.type === 'wallpaper' || activeType === 'wallpaper')" type="button" class="favorite-button" :class="{ 'is-favorite': isFavorite(item.src) }" :aria-pressed="isFavorite(item.src)" :aria-label="`${isFavorite(item.src) ? '取消喜欢' : '喜欢'}：${item.fileName}`" :title="isFavorite(item.src) ? '取消喜欢' : '加入我的喜欢'" :disabled="savingFavorite" @click.stop="toggleFavorite({ url: item.src, thumbnail: item.src, title: item.fileName, source: source === 'public' ? 'public' : 'private' })">
            <SvgIcon :icon="isFavorite(item.src) ? 'material-symbols:favorite' : 'mdi:heart-outline'" />
          </button>
          <img v-if="!failedImages.has(item.src)" :src="runtime.resolveUrl(item.src)" :alt="item.fileName" loading="lazy" class="gallery-thumbnail" @error="failedImages.add(item.src)">
          <div v-else class="gallery-image-failure">
            <span>图片加载失败</span><button type="button" @click.stop="fetchImages">
              重试
            </button>
          </div>
          <div class="p-1.5 text-xs truncate text-center bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
            {{ item.fileName }}
          </div>
        </div>
      </div>
    </div>

    <!-- 2. Wallhaven 壁纸网格 -->
    <div v-else class="flex-1 flex flex-col">
      <div v-if="wallhavenList.length === 0" class="text-center text-slate-400 py-12">
        未找到相关壁纸，换个关键词试试吧
      </div>

      <div v-else class="wallhaven-grid">
        <div
          v-for="item in wallhavenList"
          :key="item.id"
          class="wallhaven-card group relative rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-800 hover:border-emerald-500 cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 bg-zinc-900"
          @click="handleSelect(item.rawUrl)"
        >
          <!-- 缩略图 -->
          <img
            :src="item.thumbUrl"
            :alt="item.id"
            loading="lazy"
            class="wallhaven-thumbnail transition-transform duration-500 group-hover:scale-105"
          >

          <!-- 分辨率与分类浮层徽标 -->
          <button v-if="isWallpaperPicker" type="button" class="favorite-button" :class="{ 'is-favorite': isFavorite(item.rawUrl) }" :aria-pressed="isFavorite(item.rawUrl)" :aria-label="`${isFavorite(item.rawUrl) ? '取消喜欢' : '喜欢'}：Wallhaven ${item.id}`" :title="isFavorite(item.rawUrl) ? '取消喜欢' : '加入我的喜欢'" :disabled="savingFavorite" @click.stop="toggleFavorite({ url: item.rawUrl, thumbnail: item.thumbUrl || item.rawUrl, title: `Wallhaven ${item.id}`, source: 'wallhaven' })">
            <SvgIcon :icon="isFavorite(item.rawUrl) ? 'material-symbols:favorite' : 'mdi:heart-outline'" />
          </button>
          <div class="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/65 backdrop-blur-md text-[10px] font-semibold text-emerald-400 shadow">
            {{ item.resolution }}
          </div>

          <!-- 悬浮操作与信息面板 -->
          <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2 text-white">
            <div class="flex items-center justify-between text-[11px] mb-1">
              <span class="capitalize text-zinc-300">{{ item.category }}</span>
              <span class="flex items-center gap-0.5 text-zinc-300">
                <SvgIcon icon="material-symbols:favorite" class="text-rose-400 text-xs" />
                {{ item.favorites }}
              </span>
            </div>
            <button
              type="button"
              class="w-full py-1 bg-emerald-500 hover:bg-emerald-600 rounded-lg text-xs font-bold text-white shadow transition-colors"
            >
              设为壁纸
            </button>
          </div>
        </div>
      </div>

      <!-- 分页控制 -->
      <div v-if="wallhavenTotalPages > 1" class="flex justify-center mt-4 pt-3 border-t border-slate-200 dark:border-zinc-800">
        <NPagination
          v-model:page="wallhavenPage"
          :page-count="wallhavenTotalPages"
          :page-slot="5"
          size="small"
          @update-page="handlePageChange"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.gallery-selector {
  background: var(--pn-glass-panel, white);
  min-height: 480px;
  padding: 20px;
  container-type: inline-size;
}

.dark .gallery-selector {
  background: var(--pn-glass-panel, #18181c);
}
.gallery-local-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; align-content: start; }
.gallery-item-card { position: relative; }
.favorite-button { position: absolute; z-index: 2; top: 8px; right: 8px; display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid rgb(255 255 255 / 35%); border-radius: 50%; background: rgb(0 0 0 / 50%); color: white; cursor: pointer; backdrop-filter: blur(12px); }
.favorite-button :deep(svg) { width: 19px; height: 19px; }
.favorite-button.is-favorite { color: #fb7185; }
.favorite-button:focus-visible, .gallery-image-action:focus-visible { outline: 2px solid var(--pn-color-accent); outline-offset: -2px; }
.favorite-button:disabled { cursor: wait; opacity: .6; }
.favorite-card { overflow: hidden; border: 1px solid var(--pn-glass-border); border-radius: 14px; background: var(--pn-glass-control); }
.gallery-image-action { display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }
.favorite-card-caption { display: flex; flex-direction: column; gap: 4px; padding: 10px; color: var(--pn-color-text-primary); }
.favorite-card-caption span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.favorite-card-caption small, .favorites-description { color: var(--pn-color-text-secondary); font-size: 11px; }
.favorites-description { margin: 0 0 14px; line-height: 1.7; }
.favorites-empty { display: flex; min-height: 260px; align-items: center; justify-content: center; flex-direction: column; gap: 12px; text-align: center; color: var(--pn-color-text-secondary); }
.favorites-empty :deep(svg) { width: 38px; height: 38px; opacity: .5; }
.favorites-empty strong { color: var(--pn-color-text-primary); }
.favorites-empty span { font-size: 12px; }
.gallery-thumbnail, .gallery-image-failure { display: block; width: 100%; height: 118px; object-fit: cover; background: var(--pn-glass-control); }
.gallery-image-failure { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; color: var(--pn-color-text-muted); font-size: 12px; }
.gallery-image-failure button { border: 1px solid var(--pn-glass-border); border-radius: 8px; padding: 4px 10px; color: var(--pn-color-text-primary); }
.wallhaven-account-settings { border: 1px solid var(--pn-glass-border); padding: 12px; border-radius: 12px; }
.wallhaven-account-settings summary { cursor: pointer; font-size: 12px; }
.wallhaven-account-settings small, .wallhaven-account-settings a { display: block; font-size: 11px; line-height: 1.6; margin-top: 8px; }
.wallhaven-key-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.wallhaven-key-controls :deep(.n-input) { flex: 1 1 220px; }
.gallery-selection-status { font-size: 12px; color: var(--pn-color-text-secondary); }
.wallhaven-toolbar { display: flex; flex-direction: column; gap: 16px; margin: 4px 0 18px; }
.wallhaven-search-row { width: 100%; }
.wallhaven-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.wallhaven-filter { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
.wallhaven-filter > span { font-size: 12px; color: var(--pn-color-text-secondary); }
.wallhaven-rating-hint { margin: -6px 0 0; font-size: 11px; color: var(--pn-color-text-secondary); }
.wallhaven-results-summary { font-size: 12px; color: var(--pn-color-text-secondary); }
.quick-tags { gap: 8px; }
.wallhaven-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px; align-content: start; }
.wallhaven-thumbnail { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; }
@container (max-width: 580px) {
  .wallhaven-filters { grid-template-columns: 1fr; gap: 12px; }
  .wallhaven-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
}
@container (max-width: 300px) {
  .wallhaven-grid { grid-template-columns: 1fr; }
}

.source-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid #e2e8f0;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dark .source-tab-btn {
  border-color: #27272a;
  color: #a1a1aa;
}

.source-tab-btn:hover {
  border-color: #cbd5e1;
  color: #0f172a;
}

.dark .source-tab-btn:hover {
  border-color: #3f3f46;
  color: #fff;
}

.source-tab-btn.active {
  background: #10b981;
  border-color: #10b981;
  color: #fff;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
}

.wallhaven-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border-radius: 4px;
  background: #f59e0b;
  color: #000;
  font-size: 9px;
  font-weight: 800;
}

.tag-btn {
  padding: 7px 12px;
  border-radius: 9999px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid transparent;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
}

.dark .tag-btn {
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
}

.tag-btn:hover {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}

.dark .tag-btn:hover {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.tag-btn.active {
  background: #10b981;
  color: #fff;
}
</style>
