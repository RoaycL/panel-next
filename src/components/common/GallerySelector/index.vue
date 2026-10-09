<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  NButton,
  NInput,
  NInputGroup,
  NModal,
  NPagination,
  NPopover,
  NSelect,
  NSpin,
  useMessage,
} from 'naive-ui'
import { getList as getPrivateList } from '@/api/system/file'
import { getList as getPublicList } from '@/api/system/publicFile'
import { getImgbedList, getImgbedStatus } from '@/api/imgbed'
import type { ImgbedListItem } from '@/api/imgbed'
import { getWallhavenWallpapers } from '@/api/wallhaven'
import type { WallhavenSearchParams } from '@/api/wallhaven'
import { getOnlineWallpapers, wallpaperProviders } from '@/api/wallpapers'
import type { OnlineWallpaperItem, WallpaperProvider } from '@/api/wallpapers'
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

const favoriteSourceLabels: Record<FavoriteWallpaper['source'], string> = {
  private: '个人图库',
  public: '公共图库',
  imgbed: '外部图床',
  wallhaven: 'Wallhaven',
  bing: 'Bing 每日',
  unsplash: 'Unsplash',
  pexels: 'Pexels',
  konachan: 'Konachan',
  yandere: 'yande.re',
}
function favoriteSourceLabel(value: FavoriteWallpaper['source']) {
  return favoriteSourceLabels[value] ?? '个人图库'
}
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
// 在线壁纸库的壁纸源：Wallhaven 之外的源都由服务端统一代理；上次选的源记在本机
const PROVIDER_STORAGE_KEY = 'PANEL_NEXT_WALLPAPER_PROVIDER_V1'
function readSavedProvider(): WallpaperProvider {
  try {
    const saved = runtime.storage.getItem(PROVIDER_STORAGE_KEY)
    return wallpaperProviders.find(item => item.value === saved)?.value ?? 'wallhaven'
  }
  catch { return 'wallhaven' }
}
const provider = ref<WallpaperProvider>(readSavedProvider())
const providerInfo = computed(() => wallpaperProviders.find(item => item.value === provider.value) ?? wallpaperProviders[0])
const extraSorting = ref(providerInfo.value.sortingOptions?.[0]?.value ?? '')
const booruPurity = ref('100')
const onlineError = ref('')

const apiKeyStorageKey = computed(() => `WALLHAVEN_API_KEY_V1:${auth.userInfo?.id ?? 'guest'}`)
const extraKeyStorageKey = (name: WallpaperProvider) => `WALLPAPER_API_KEY_V1:${name}:${auth.userInfo?.id ?? 'guest'}`
const apiKeyDraft = ref('')
const wallhavenApiKey = ref('')
const wallhavenPurity = ref('100')
const extraApiKeys = ref<Partial<Record<WallpaperProvider, string>>>({})
const currentApiKey = computed(() => provider.value === 'wallhaven' ? wallhavenApiKey.value : extraApiKeys.value[provider.value] || '')
watch(apiKeyStorageKey, key => {
  wallhavenApiKey.value = runtime.storage.getItem(key) || ''
  const keys: Partial<Record<WallpaperProvider, string>> = {}
  for (const item of wallpaperProviders) {
    if (item.keyUrl && item.value !== 'wallhaven') keys[item.value] = runtime.storage.getItem(extraKeyStorageKey(item.value)) || ''
  }
  extraApiKeys.value = keys
  apiKeyDraft.value = currentApiKey.value
  wallhavenPurity.value = '100'
}, { immediate: true })
// 位串：SFW / Sketchy / NSFW，可多选；NSFW 需要 API Key
const purityOptions = computed(() => [
  { label: 'SFW', bit: 0 },
  { label: 'Sketchy', bit: 1 },
  { label: 'NSFW', bit: 2, disabled: !wallhavenApiKey.value && provider.value === 'wallhaven' },
])
function isPurityOn(bit: number) {
  return wallhavenPurity.value[bit] === '1'
}
// 可多选，但至少保留一个分级
function togglePurity(bit: number) {
  const bits = wallhavenPurity.value.split('')
  bits[bit] = bits[bit] === '1' ? '0' : '1'
  if (!bits.includes('1')) return
  wallhavenPurity.value = bits.join('')
  handleWallhavenSearch()
}
function toggleBooruPurity(bit: number) {
  const bits = booruPurity.value.split('')
  bits[bit] = bits[bit] === '1' ? '0' : '1'
  if (!bits.includes('1')) return
  booruPurity.value = bits.join('')
  handleOnlineSearch()
}
async function saveApiKey() {
  if (provider.value !== 'wallhaven') { await saveExtraApiKey(); return }
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
  if (!key) {
    // 清除 Key 后去掉 NSFW；只剩 NSFW 时回到 SFW
    const next = `${wallhavenPurity.value.slice(0, 2)}0`
    wallhavenPurity.value = next === '000' ? '100' : next
  }
  ms.success(key ? 'API Key 已保存在本机' : 'API Key 已清除')
  handleWallhavenSearch()
}
async function saveExtraApiKey() {
  const name = provider.value
  const label = providerInfo.value.label
  const key = apiKeyDraft.value.trim()
  const storageKey = extraKeyStorageKey(name)
  if (key && !/^[\w-]{16,128}$/.test(key)) { ms.error(`API Key 格式无效，请从 ${label} 开发者页面复制`); return }
  try {
    if (key) runtime.storage.setItem(storageKey, key)
    else runtime.storage.removeItem(storageKey)
    await runtime.storage.flush?.()
  }
  catch { ms.error('API Key 本机保存失败，请重试'); return }
  if (storageKey !== extraKeyStorageKey(provider.value)) return
  extraApiKeys.value = { ...extraApiKeys.value, [name]: key }
  ms.success(key ? 'API Key 已保存在本机' : 'API Key 已清除')
  handleOnlineSearch()
}
let requestGeneration = 0
let selectionGeneration = 0
const selectingUrl = ref('')
const failedImages = ref(new Set<string>())
onBeforeUnmount(() => { requestGeneration++; selectionGeneration++ })
const loading = ref(false)
const resultsRef = ref<HTMLElement | null>(null)
const source = ref<'private' | 'public' | 'online' | 'favorites' | 'imgbed'>('private')

// 外部图床：仅在服务端已配置图床（且当前账号是管理员）时显示这一栏
const imgbedAvailable = ref(false)
const imgbedList = ref<ImgbedListItem[]>([])
const imgbedPage = ref(1)
const imgbedTotal = ref(0)
const IMGBED_PAGE_SIZE = 40
const imgbedPageCount = computed(() => Math.max(1, Math.ceil(imgbedTotal.value / IMGBED_PAGE_SIZE)))
const imgbedError = ref('')
let imgbedStatusGeneration = 0
async function refreshImgbedStatus() {
  const generation = ++imgbedStatusGeneration
  let available = false
  if (auth.token) {
    try { available = (await getImgbedStatus()).data?.available === true }
    catch { available = false }
  }
  if (generation !== imgbedStatusGeneration) return
  imgbedAvailable.value = available
  if (!available && source.value === 'imgbed') source.value = 'private'
}

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
const onlineList = ref<OnlineWallpaperItem[]>([])
const onlinePage = ref(1)
watch([source, onlinePage, imgbedPage], () => { resultsRef.value?.scrollTo({ top: 0 }) }, { flush: 'post' })
const onlineTotalPages = ref(1)
const onlineTotal = ref(0)
const onlineQuery = ref('')
const wallhavenSorting = ref<'toplist' | 'hot' | 'views' | 'random' | 'date_added'>('toplist')
const wallhavenCategories = ref('111') // 位串：综合 / 动漫 / 人物，默认全选
const wallhavenCategoryOptions = [
  { label: '综合', bit: 0 },
  { label: '动漫', bit: 1 },
  { label: '人物', bit: 2 },
]
function isCategoryOn(bit: number) {
  return wallhavenCategories.value[bit] === '1'
}
// 可多选，但至少保留一个分类
function toggleCategory(bit: number) {
  const bits = wallhavenCategories.value.split('')
  bits[bit] = bits[bit] === '1' ? '0' : '1'
  if (!bits.includes('1')) return
  wallhavenCategories.value = bits.join('')
  handleWallhavenSearch()
}

const wallhavenSortingOptions = [
  { label: '最热榜单', value: 'toplist' },
  { label: '近期热门', value: 'hot' },
  { label: '最多浏览', value: 'views' },
  { label: '随机发现', value: 'random' },
  { label: '最新上传', value: 'date_added' },
]

// cat 为 Wallhaven 分类位：General / Anime / People；内容分级仍由 purity 决定
const quickTags = [
  { label: '🌟 精选推荐', q: '', cat: '111' },
  { label: '🎨 动漫二次元', q: 'anime', cat: '010' },
  { label: '🌄 自然风光', q: 'nature landscape', cat: '100' },
  { label: '🏙️ 赛博朋克', q: 'cyberpunk', cat: '110' },
  { label: '🌌 宇宙星空', q: 'space galaxy', cat: '100' },
  { label: '💻 科技极简', q: 'minimalism tech', cat: '100' },
  { label: '🚗 顶级超跑', q: 'supercar', cat: '100' },
  { label: '👩 美女写真', q: 'women', cat: '001' },
  { label: '🎭 Cosplay', q: 'cosplay', cat: '011' },
]

async function fetchImgbed() {
  const generation = ++requestGeneration
  loading.value = true
  imgbedList.value = []
  imgbedError.value = ''
  failedImages.value = new Set()
  try {
    const res = await getImgbedList(imgbedPage.value, IMGBED_PAGE_SIZE)
    if (generation !== requestGeneration) return
    if (res.code !== 0 || !res.data) { imgbedError.value = res.msg || '读取图床图片失败'; return }
    imgbedList.value = res.data.items || []
    imgbedTotal.value = res.data.total || 0
  }
  catch { if (generation === requestGeneration) imgbedError.value = '读取图床图片失败，请检查网络后重试' }
  finally { if (generation === requestGeneration) loading.value = false }
}
function handleImgbedPageChange(page: number) {
  imgbedPage.value = page
  void fetchImgbed()
}
function imgbedTitle(item: ImgbedListItem) {
  return item.name.split('/').pop() || item.name
}

async function fetchImages() {
  if (source.value === 'favorites') { requestGeneration++; loading.value = false; return }
  if (source.value === 'imgbed') { await fetchImgbed(); return }
  if (source.value === 'online') { await fetchOnline(); return }
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

// 关键词 + 分类 + 分辨率 + 比例 + 榜单时间同时生效时，冷门组合常为 0 张；
// 首页无结果时逐级放宽：榜单时间 1 个月 → 1 年，再去掉 16:9/16:10 比例限制。
const WALLHAVEN_RELAX_STEPS = [
  { topRange: '1M', ratios: '16x9,16x10', note: '' },
  { topRange: '1y', ratios: '16x9,16x10', note: '近一个月没有结果，已扩大到近一年' },
  { topRange: '1y', ratios: undefined, note: '已放宽到近一年、不限屏幕比例' },
] as const
const wallhavenRelaxLevel = ref(0)
const wallhavenRelaxNote = computed(() => WALLHAVEN_RELAX_STEPS[wallhavenRelaxLevel.value].note)

function fetchOnline() {
  return provider.value === 'wallhaven' ? fetchWallhaven() : fetchExtraWallpapers()
}

async function fetchExtraWallpapers() {
  const info = providerInfo.value
  const generation = ++requestGeneration
  onlineList.value = []
  onlineError.value = ''
  onlineTotal.value = 0
  onlineTotalPages.value = 1
  if (info.keyUrl && !currentApiKey.value) {
    loading.value = false
    onlineError.value = `${info.label} 需要你自己的免费 API Key，请在「高级设置」中填写`
    return
  }
  loading.value = true
  try {
    const res = await getOnlineWallpapers({
      source: info.value as Exclude<WallpaperProvider, 'wallhaven'>,
      q: info.searchable ? onlineQuery.value.trim() || undefined : undefined,
      purity: info.ratings ? booruPurity.value : undefined,
      sorting: info.sortingOptions ? extraSorting.value : undefined,
      page: onlinePage.value,
    }, currentApiKey.value)
    if (generation !== requestGeneration) return
    if (res.code !== 0 || !res.data) { onlineError.value = res.msg || `获取 ${info.label} 壁纸失败`; return }
    onlineList.value = res.data.items || []
    onlineTotalPages.value = res.data.meta.lastPage || 1
    onlineTotal.value = res.data.meta.total || 0
  }
  catch { if (generation === requestGeneration) onlineError.value = `请求 ${info.label} 失败，请检查网络后重试` }
  finally { if (generation === requestGeneration) loading.value = false }
}

function selectProvider(value: WallpaperProvider) {
  if (provider.value === value) return
  provider.value = value
  try { runtime.storage.setItem(PROVIDER_STORAGE_KEY, value) }
  catch { /* 只是记住上次的选择，失败不影响使用 */ }
  onlineQuery.value = ''
  extraSorting.value = providerInfo.value.sortingOptions?.[0]?.value ?? ''
  apiKeyDraft.value = currentApiKey.value
  handleOnlineSearch()
}

function onlineItemTitle(item: OnlineWallpaperItem) {
  if (provider.value === 'bing' && item.title) return item.title
  return `${providerInfo.value.label} ${item.id}`
}

async function fetchWallhaven() {
  const generation = ++requestGeneration
  loading.value = true
  onlineList.value = []
  onlineError.value = ''
  if (onlinePage.value === 1) wallhavenRelaxLevel.value = 0
  try {
    while (true) {
      const step = WALLHAVEN_RELAX_STEPS[wallhavenRelaxLevel.value]
      const params: WallhavenSearchParams = {
        q: onlineQuery.value.trim() || undefined,
        categories: wallhavenCategories.value,
        purity: wallhavenPurity.value,
        sorting: wallhavenSorting.value,
        topRange: step.topRange,
        atleast: '1920x1080',
        ratios: step.ratios,
        page: onlinePage.value,
      }
      const res = await getWallhavenWallpapers(params, wallhavenApiKey.value)
      if (generation !== requestGeneration) return
      if (res.code !== 0 || !res.data) {
        ms.error(res.msg || '获取 Wallhaven 壁纸失败')
        return
      }
      const canRelax = onlinePage.value === 1 && !res.data.items?.length && wallhavenRelaxLevel.value < WALLHAVEN_RELAX_STEPS.length - 1
      // 非榜单排序不受时间范围影响，跳过只改 topRange 的那一级
      if (canRelax) {
        wallhavenRelaxLevel.value++
        if (wallhavenSorting.value !== 'toplist' && wallhavenRelaxLevel.value === 1) wallhavenRelaxLevel.value++
        continue
      }
      onlineList.value = res.data.items || []
      onlineTotalPages.value = res.data.meta.lastPage || 1
      onlineTotal.value = res.data.meta.total || 0
      return
    }
  }
  catch {
    if (generation === requestGeneration) ms.error('请求 Wallhaven 服务失败，请检查 API Key 或网络后重试')
  }
  finally {
    if (generation === requestGeneration) loading.value = false
  }
}

// 壁纸库点击图片先放大预览，确认后再设为壁纸
const previewIndex = ref(-1)
const previewItem = computed(() => onlineList.value[previewIndex.value])
const previewRawLoaded = ref(false)
const previewRawFailed = ref(false)
const previewAttempt = ref(0)
const previewDialog = ref<HTMLElement | null>(null)
const showPreview = computed({
  get: () => !!previewItem.value,
  set: value => { if (!value) previewIndex.value = -1 },
})
function openPreview(index: number) {
  previewRawLoaded.value = false
  previewRawFailed.value = false
  previewIndex.value = index
  // 关闭了 NModal 自动聚焦，手动聚焦对话框，方向键才能直接切换
  void nextTick(() => previewDialog.value?.focus())
}
function retryPreviewRaw() {
  previewRawFailed.value = false
  previewAttempt.value++
}
function stepPreview(delta: number) {
  const next = previewIndex.value + delta
  if (next < 0 || next >= onlineList.value.length) return
  openPreview(next)
}
function handlePreviewKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') stepPreview(-1)
  else if (event.key === 'ArrowRight') stepPreview(1)
}
async function applyPreview() {
  const item = previewItem.value
  if (!item) return
  if (await handleSelect(item.rawUrl) && previewItem.value === item) previewIndex.value = -1
}
watch(onlineList, () => { previewIndex.value = -1 })

function handleQuickTagClick(tag: typeof quickTags[number]) {
  onlineQuery.value = tag.q
  wallhavenCategories.value = tag.cat
  onlinePage.value = 1
  void fetchWallhaven()
}

// naive-ui 先调用 @update-value 再更新 v-model，等值写入后再请求，否则会用旧筛选条件
function afterSelectChange(handler: () => unknown) {
  void nextTick(handler)
}

function handleWallhavenSearch() {
  onlinePage.value = 1
  void fetchWallhaven()
}

function handleOnlineSearch() {
  onlinePage.value = 1
  void fetchOnline()
}

function handleExtraTagClick(q: string) {
  onlineQuery.value = q
  handleOnlineSearch()
}

function handlePageChange(page: number) {
  onlinePage.value = page
  void fetchOnline()
}

async function handleSelect(url: string): Promise<boolean> {
  const generation = ++selectionGeneration
  selectingUrl.value = url
  try {
    await preloadWallpaper(runtime.resolveUrl(url))
    if (generation !== selectionGeneration) return false
    emit('select', url)
    ms.success(props.type === 'wallpaper' ? '壁纸已加载并选择' : '已选择图片')
    return true
  }
  catch (error) {
    if (generation === selectionGeneration) ms.error(error instanceof Error ? error.message : '图片加载失败')
    return false
  }
  finally { if (generation === selectionGeneration) selectingUrl.value = '' }
}

watch(source, () => {
  selectionGeneration++
  selectingUrl.value = ''
  void fetchImages()
})
watch(() => [auth.token, auth.userInfo?.id], () => { void refreshImgbedStatus() })
watch(apiKeyStorageKey, () => {
  requestGeneration++
  selectionGeneration++
  selectingUrl.value = ''
  onlineList.value = []
  void fetchImages()
})

onMounted(() => {
  void refreshImgbedStatus()
  void fetchImages()
})
</script>

<template>
  <div class="gallery-selector p-3 h-full overflow-auto flex flex-col" :class="{ 'is-wallpaper-picker': isWallpaperPicker }">
    <!-- 顶部来源切换导航 -->
    <div class="gallery-navigation flex items-center justify-between mb-3 gap-2 flex-wrap pb-2 border-b border-slate-200 dark:border-zinc-800">
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
          v-if="imgbedAvailable"
          type="button"
          class="source-tab-btn"
          :class="{ active: source === 'imgbed' }"
          @click="source = 'imgbed'"
        >
          <SvgIcon icon="mdi:cloud-outline" class="text-sm" />
          <span>外部图床</span>
        </button>

        <button
          v-if="!isWallpaperPicker"
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
          :class="{ active: source === 'online' }"
          @click="source = 'online'"
        >
          <span class="wallhaven-badge">4K</span>
          <span>在线壁纸库</span>
        </button>
      </div>

      <!-- 本地/公共筛选 -->
      <NSelect
        v-if="!isWallpaperPicker && (source === 'private' || source === 'public')"
        v-model:value="activeType"
        :options="sourceOptions"
        size="small"
        style="width: 140px"
        @update-value="afterSelectChange(fetchImages)"
      />
      <NButton v-if="source === 'private' || source === 'public'" size="small" secondary @click="fetchImages">
        刷新图库
      </NButton>
    </div>

    <!-- 在线壁纸库工具栏：先选壁纸源，再按源显示搜索与筛选 -->
    <div v-if="source === 'online'" class="wallhaven-toolbar">
      <div class="provider-tabs" role="tablist" aria-label="壁纸源">
        <button
          v-for="item in wallpaperProviders"
          :key="item.value"
          type="button"
          role="tab"
          class="tag-btn provider-tab"
          :class="{ active: provider === item.value }"
          :aria-selected="provider === item.value"
          @click="selectProvider(item.value)"
        >
          {{ item.label }}
        </button>
      </div>
      <!-- 搜索与排序 -->
      <div v-if="providerInfo.searchable || providerInfo.keyUrl" class="wallhaven-search-row">
        <NInputGroup v-if="providerInfo.searchable">
          <NInput
            v-model:value="onlineQuery"
            :placeholder="providerInfo.searchPlaceholder || '搜索壁纸，发现喜欢的风景…'"
            clearable
            @keydown.enter="handleOnlineSearch"
          />
          <NButton type="primary" class="wallhaven-search-btn" @click="handleOnlineSearch">
            <template #icon>
              <SvgIcon icon="material-symbols:search-rounded" />
            </template>
            搜索
          </NButton>
        </NInputGroup>
        <NPopover v-if="providerInfo.keyUrl" trigger="click" placement="bottom-end" :width="340" class="wallhaven-advanced-popover">
          <template #trigger>
            <NButton secondary>
              高级设置
            </NButton>
          </template>
          <div class="wallhaven-advanced-content">
            <div class="wallhaven-account-settings">
              <strong>{{ providerInfo.label }} API Key · {{ currentApiKey ? '已配置' : '未配置' }}</strong>
              <div class="wallhaven-key-controls">
                <NInput v-model:value="apiKeyDraft" type="password" show-password-on="click" :placeholder="provider === 'wallhaven' ? '从 Wallhaven 账号设置复制 API Key' : `粘贴 ${providerInfo.label} 的 API Key（Access Key）`" autocomplete="off" :maxlength="128" :aria-label="`${providerInfo.label} API Key`" />
                <NButton size="small" @click="saveApiKey">
                  保存到本机
                </NButton>
                <NButton size="small" @click="apiKeyDraft = ''; saveApiKey()">
                  清除
                </NButton>
              </div>
              <small v-if="provider !== 'wallhaven'">{{ providerInfo.label }} 的 API Key 可免费申请，申请后粘贴到这里即可浏览和搜索。</small>
              <small>仅保存在当前浏览器和当前账号下，不随布局同步。搜索时交由你连接的 Panel Next 服务转发至 {{ providerInfo.label }}，不放入 URL。请使用可信的 HTTPS 服务。</small>
              <a :href="providerInfo.keyUrl" target="_blank" rel="noopener noreferrer">{{ provider === 'wallhaven' ? '打开 Wallhaven 账号设置' : `申请 ${providerInfo.label} API Key` }}</a>
            </div>
          </div>
        </NPopover>
      </div>
      <p v-if="provider === 'bing'" class="wallhaven-results-summary">
        Bing 每日一图，最近 15 天，4K 原图，每天更新
      </p>
      <div v-if="provider === 'wallhaven'" class="wallhaven-filters">
        <label class="wallhaven-filter"><span>排序方式</span>
          <NSelect
            v-model:value="wallhavenSorting"
            :options="wallhavenSortingOptions"
            aria-label="Wallhaven 排序方式"
            @update-value="afterSelectChange(handleWallhavenSearch)"
          />
        </label>

        <div class="wallhaven-filter" role="group" aria-label="内容分级，可多选">
          <span>内容分级 · 可多选</span>
          <div class="category-toggles">
            <button
              v-for="option in purityOptions"
              :key="option.bit"
              type="button"
              class="tag-btn category-toggle"
              :class="{ active: isPurityOn(option.bit) }"
              :aria-pressed="isPurityOn(option.bit)"
              :disabled="option.disabled"
              :title="option.disabled ? '需在「高级设置」中配置 Wallhaven API Key' : undefined"
              @click="togglePurity(option.bit)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="wallhaven-filter" role="group" aria-label="壁纸分类，可多选">
          <span>壁纸分类 · 可多选</span>
          <div class="category-toggles">
            <button
              v-for="option in wallhavenCategoryOptions"
              :key="option.bit"
              type="button"
              class="tag-btn category-toggle"
              :class="{ active: isCategoryOn(option.bit) }"
              :aria-pressed="isCategoryOn(option.bit)"
              @click="toggleCategory(option.bit)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>


      <div v-else-if="providerInfo.sortingOptions || providerInfo.ratings" class="wallhaven-filters extra-filters">
        <label v-if="providerInfo.sortingOptions" class="wallhaven-filter"><span>排序方式</span>
          <NSelect
            v-model:value="extraSorting"
            :options="providerInfo.sortingOptions"
            :aria-label="`${providerInfo.label} 排序方式`"
            @update-value="afterSelectChange(handleOnlineSearch)"
          />
        </label>
        <div v-if="providerInfo.ratings" class="wallhaven-filter" role="group" aria-label="内容分级，可多选">
          <span>内容分级 · 可多选</span>
          <div class="category-toggles">
            <button
              v-for="option in purityOptions"
              :key="option.bit"
              type="button"
              class="tag-btn category-toggle"
              :class="{ active: booruPurity[option.bit] === '1' }"
              :aria-pressed="booruPurity[option.bit] === '1'"
              @click="toggleBooruPurity(option.bit)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- 热门快捷标签 -->
      <div v-if="providerInfo.quickTags" class="quick-tags flex items-center gap-1.5 flex-wrap">
        <button
          v-for="tag in providerInfo.quickTags"
          :key="tag.label"
          type="button"
          class="tag-btn"
          :class="{ active: onlineQuery === tag.q }"
          @click="handleExtraTagClick(tag.q)"
        >
          {{ isWallpaperPicker ? tag.label.replace(/^\S+\s/, '') : tag.label }}
        </button>
      </div>
      <div v-else-if="provider === 'wallhaven'" class="quick-tags flex items-center gap-1.5 flex-wrap">
        <button
          v-for="tag in quickTags"
          :key="tag.label"
          type="button"
          class="tag-btn"
          :class="{ active: onlineQuery === tag.q }"
          @click="handleQuickTagClick(tag)"
        >
          {{ isWallpaperPicker ? tag.label.replace(/^\S+\s/, '') : tag.label }}
        </button>
      </div>
      <div v-if="onlineTotal > 0 && provider !== 'bing'" class="wallhaven-results-summary">
        找到约 {{ onlineTotal }} 张壁纸 · 第 {{ onlinePage }} 页{{ provider === 'wallhaven' && wallhavenRelaxNote ? ` · ${wallhavenRelaxNote}` : '' }}{{ provider === 'unsplash' || provider === 'pexels' ? ` · 图片来自 ${providerInfo.label}，版权归摄影师所有` : '' }}
      </div>
    </div>
    <p v-if="selectingUrl" role="status" class="gallery-selection-status">
      正在加载原图，成功后应用；期间保留当前壁纸…
    </p>

    <div ref="resultsRef" class="gallery-results" :class="{ 'is-wallpaper-results': isWallpaperPicker }">
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
          <NButton secondary @click="source = 'online'">
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
              <span>{{ item.title }}</span><small>{{ favoriteSourceLabel(item.source) }}</small>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="source === 'imgbed'" class="flex-1">
        <div v-if="imgbedError" class="favorites-empty">
          <SvgIcon icon="mdi:cloud-outline" />
          <strong>{{ imgbedError }}</strong>
          <NButton secondary @click="fetchImgbed">
            重试
          </NButton>
        </div>
        <div v-else-if="!imgbedList.length" class="text-center text-slate-400 py-12">
          图床里还没有图片
        </div>
        <div v-else class="gallery-local-grid">
          <div v-for="item in imgbedList" :key="item.url" class="gallery-item-card favorite-card">
            <button type="button" class="gallery-image-action" :aria-label="`使用图片：${imgbedTitle(item)}`" @click="handleSelect(item.url)">
              <img v-if="!failedImages.has(item.url)" :src="item.url" :alt="imgbedTitle(item)" loading="lazy" class="gallery-thumbnail" @error="failedImages.add(item.url)">
              <span v-else class="gallery-image-failure">预览加载失败，点击尝试原图</span>
            </button>
            <button v-if="isWallpaperPicker" type="button" class="favorite-button" :class="{ 'is-favorite': isFavorite(item.url) }" :aria-pressed="isFavorite(item.url)" :aria-label="`${isFavorite(item.url) ? '取消喜欢' : '喜欢'}：${imgbedTitle(item)}`" :title="isFavorite(item.url) ? '取消喜欢' : '加入我的喜欢'" :disabled="savingFavorite" @click.stop="toggleFavorite({ url: item.url, thumbnail: item.url, title: imgbedTitle(item), source: 'imgbed' })">
              <SvgIcon :icon="isFavorite(item.url) ? 'material-symbols:favorite' : 'mdi:heart-outline'" />
            </button>
            <div class="favorite-card-caption">
              <span>{{ imgbedTitle(item) }}</span><small>{{ item.name }}</small>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="source !== 'online'" class="flex-1">
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

      <!-- 2. 在线壁纸网格 -->
      <div v-else class="flex-1 flex flex-col">
        <div v-if="onlineError" class="favorites-empty">
          <SvgIcon icon="mdi:image-off-outline" />
          <strong>{{ onlineError }}</strong>
          <span v-if="providerInfo.keyUrl && !currentApiKey"><a :href="providerInfo.keyUrl" target="_blank" rel="noopener noreferrer">免费申请 {{ providerInfo.label }} API Key</a>，申请后填到「高级设置」</span>
          <NButton v-else secondary @click="fetchOnline">
            重试
          </NButton>
        </div>
        <div v-else-if="onlineList.length === 0" class="text-center text-slate-400 py-12">
          {{ provider === 'wallhaven' ? '已放宽时间范围和屏幕比例仍未找到壁纸，可以换个关键词，或把内容范围、排序方式换一下试试' : '没有找到壁纸，换个关键词或筛选条件试试' }}
        </div>

        <div v-else class="wallhaven-grid">
          <div
            v-for="(item, index) in onlineList"
            :key="item.id"
            class="wallhaven-card group relative rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-800 hover:border-emerald-500 cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 bg-zinc-900"
            @click="openPreview(index)"
          >
            <!-- 缩略图：独立按钮承担键盘/读屏的「预览」入口，点击冒泡到卡片打开预览 -->
            <button type="button" class="wallhaven-preview-trigger" :aria-label="`预览壁纸：${onlineItemTitle(item)}`">
              <img
                :src="item.thumbUrl"
                :alt="onlineItemTitle(item)"
                loading="lazy"
                class="wallhaven-thumbnail transition-transform duration-500 group-hover:scale-105"
              >
            </button>

            <!-- 分辨率与分类浮层徽标 -->
            <button v-if="isWallpaperPicker" type="button" class="favorite-button" :class="{ 'is-favorite': isFavorite(item.rawUrl) }" :aria-pressed="isFavorite(item.rawUrl)" :aria-label="`${isFavorite(item.rawUrl) ? '取消喜欢' : '喜欢'}：${onlineItemTitle(item)}`" :title="isFavorite(item.rawUrl) ? '取消喜欢' : '加入我的喜欢'" :disabled="savingFavorite" @click.stop="toggleFavorite({ url: item.rawUrl, thumbnail: item.thumbUrl || item.rawUrl, title: onlineItemTitle(item), source: provider })">
              <SvgIcon :icon="isFavorite(item.rawUrl) ? 'material-symbols:favorite' : 'mdi:heart-outline'" />
            </button>
            <div v-if="item.resolution" class="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/65 backdrop-blur-md text-[10px] font-semibold text-emerald-400 shadow">
              {{ item.resolution }}
            </div>

            <!-- 悬浮操作与信息面板 -->
            <div class="wallhaven-card-overlay absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2 text-white">
              <div class="flex items-center justify-between text-[11px] mb-1">
                <span class="capitalize text-zinc-300 truncate">{{ provider === 'unsplash' || provider === 'pexels' ? item.author : provider === 'bing' ? item.title : item.category }}</span>
                <span v-if="provider === 'wallhaven' || providerInfo.scoreLabel" class="flex items-center gap-0.5 text-zinc-300">
                  <SvgIcon icon="material-symbols:favorite" class="text-rose-400 text-xs" />
                  {{ item.favorites }}
                </span>
              </div>
              <span class="wallhaven-card-preview-hint">点击预览</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- 分页控制 -->
    <div v-if="source === 'online' && onlineTotalPages > 1" class="gallery-pagination">
      <NPagination
        v-model:page="onlinePage"
        :page-count="onlineTotalPages"
        :page-slot="5"
        size="small"
        @update-page="handlePageChange"
      />
    </div>
    <div v-if="source === 'imgbed' && imgbedPageCount > 1" class="gallery-pagination">
      <NPagination :page="imgbedPage" :page-count="imgbedPageCount" :page-slot="5" size="small" @update-page="handleImgbedPageChange" />
    </div>
    <NModal v-if="previewItem" v-model:show="showPreview" :auto-focus="false">
      <div ref="previewDialog" class="wallhaven-preview" role="dialog" aria-modal="true" :aria-label="`壁纸预览：${onlineItemTitle(previewItem)}`" tabindex="-1" @keydown="handlePreviewKeydown">
        <div class="wallhaven-preview-stage">
          <img v-if="!previewRawLoaded" :src="previewItem.thumbUrl" alt="" aria-hidden="true" class="wallhaven-preview-image is-thumb">
          <img v-if="!previewRawFailed" :key="`${previewItem.rawUrl}#${previewAttempt}`" :src="previewItem.rawUrl" :alt="onlineItemTitle(previewItem)" class="wallhaven-preview-image" :class="{ 'is-loaded': previewRawLoaded }" @load="previewRawLoaded = true" @error="previewRawFailed = true">
          <span v-if="previewRawFailed" class="wallhaven-preview-loading" role="alert">原图加载失败，当前显示的是缩略图 <button type="button" class="wallhaven-preview-retry" @click="retryPreviewRaw">重试</button></span>
          <span v-else-if="!previewRawLoaded" class="wallhaven-preview-loading">正在加载原图…</span>
          <button type="button" class="wallhaven-preview-nav is-prev" aria-label="上一张" :disabled="previewIndex <= 0" @click="stepPreview(-1)">
            <SvgIcon icon="material-symbols:chevron-left-rounded" />
          </button>
          <button type="button" class="wallhaven-preview-nav is-next" aria-label="下一张" :disabled="previewIndex >= onlineList.length - 1" @click="stepPreview(1)">
            <SvgIcon icon="material-symbols:chevron-right-rounded" />
          </button>
          <button type="button" class="wallhaven-preview-close" aria-label="关闭预览" @click="showPreview = false">
            <SvgIcon icon="material-symbols:close-rounded" />
          </button>
        </div>
        <div class="wallhaven-preview-bar">
          <div class="wallhaven-preview-meta">
            <strong v-if="previewItem.resolution">{{ previewItem.resolution }}</strong>
            <span v-if="previewItem.category" class="capitalize">{{ previewItem.category }}</span>
            <span v-if="provider === 'wallhaven' || providerInfo.scoreLabel"><SvgIcon icon="material-symbols:favorite" class="text-rose-400" /> {{ previewItem.favorites }}</span>
            <span v-if="provider === 'bing' && previewItem.author" class="wallhaven-preview-credit">{{ previewItem.author }}</span>
            <span v-else-if="previewItem.author && previewItem.authorUrl" class="wallhaven-preview-credit">摄影：<a :href="previewItem.authorUrl" target="_blank" rel="noopener noreferrer">{{ previewItem.author }}</a> · {{ providerInfo.label }}</span>
            <a :href="previewItem.url" target="_blank" rel="noopener noreferrer">在 {{ providerInfo.label.replace(' 每日', '') }} 查看</a>
          </div>
          <div class="wallhaven-preview-actions">
            <NButton v-if="isWallpaperPicker" secondary :disabled="savingFavorite" @click="toggleFavorite({ url: previewItem.rawUrl, thumbnail: previewItem.thumbUrl || previewItem.rawUrl, title: onlineItemTitle(previewItem), source: provider })">
              {{ isFavorite(previewItem.rawUrl) ? '取消喜欢' : '加入喜欢' }}
            </NButton>
            <NButton type="primary" :loading="selectingUrl === previewItem.rawUrl" :disabled="!!selectingUrl && selectingUrl !== previewItem.rawUrl" @click="applyPreview">
              {{ isWallpaperPicker ? '设为壁纸' : '使用这张图' }}
            </NButton>
          </div>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.gallery-selector {
  background: var(--pn-glass-panel, white);
  min-height: 480px;
  padding: 20px;
  container-type: inline-size;
}

.gallery-selector.is-wallpaper-picker { display: flex; flex-direction: column; flex: 1; width: 100%; height: 100%; min-height: 0; overflow: hidden; padding: 16px 24px 0; background: transparent; }
.is-wallpaper-picker .gallery-navigation { flex: none; margin-bottom: 12px; padding-bottom: 12px; }
.is-wallpaper-picker .wallhaven-toolbar { flex: none; gap: 10px; margin: 0 0 12px; }
.wallhaven-search-row { display: flex; align-items: center; gap: 10px; }
.wallhaven-search-row > :deep(.n-input-group) { min-width: 0; flex: 1; }
.wallhaven-search-row > :deep(.n-button) { flex: none; }
.wallhaven-advanced-content { display: grid; gap: 16px; max-height: min(420px, 65dvh); overflow: auto; }
:global(.wallhaven-advanced-popover) { max-width: calc(100vw - 24px); }
.is-wallpaper-picker .quick-tags { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
.is-wallpaper-picker .quick-tags .tag-btn { flex: none; white-space: nowrap; }
.is-wallpaper-results { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 0 2px 18px; }
.gallery-pagination { display: flex; flex: none; align-items: center; justify-content: center; padding: 12px 0; border-top: 1px solid var(--pn-glass-border); }
.is-wallpaper-picker .gallery-local-grid, .is-wallpaper-picker .wallhaven-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
.is-wallpaper-picker .gallery-thumbnail, .is-wallpaper-picker .gallery-image-failure { height: auto; aspect-ratio: 16 / 10; }
.wallhaven-card-preview-hint { font-size: 12px; color: white; }
.wallhaven-card-overlay { pointer-events: none; }
@media (max-width: 640px) {
  .gallery-selector.is-wallpaper-picker { padding: 12px 12px 0; }
  .is-wallpaper-picker .source-tab-btn { padding: 6px 8px; font-size: 11px; }
  .is-wallpaper-picker .wallhaven-filters { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 10px; }
  .is-wallpaper-picker .wallhaven-filters > :last-child { grid-column: 1 / -1; }
  .is-wallpaper-picker .wallhaven-filter { gap: 4px; }
  .is-wallpaper-picker .wallhaven-filter > span { font-size: 10px; }
  .is-wallpaper-picker .category-toggles { gap: 3px; }
  .is-wallpaper-picker .category-toggle { font-size: 11px; }
  .is-wallpaper-picker .gallery-local-grid, .is-wallpaper-picker .wallhaven-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
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
.wallhaven-account-settings strong { font-size: 12px; }
.wallhaven-account-settings small, .wallhaven-account-settings a { display: block; font-size: 11px; line-height: 1.6; margin-top: 8px; }
.wallhaven-key-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.wallhaven-key-controls :deep(.n-input) { flex: 1 1 220px; }
.gallery-selection-status { font-size: 12px; color: var(--pn-color-text-secondary); }
.wallhaven-toolbar { display: flex; flex-direction: column; gap: 16px; margin: 4px 0 18px; }
.wallhaven-search-row { width: 100%; }
.wallhaven-filters { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(200px, 1.3fr) minmax(240px, 2fr); gap: 16px; }
.category-toggles { display: flex; min-height: 34px; align-items: center; gap: 8px; }
.category-toggle { flex: 1 1 0; min-width: 0; padding: 8px 0; font-size: 12px; }
.wallhaven-filter { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
.wallhaven-filter > span { font-size: 12px; color: var(--pn-color-text-secondary); }
.wallhaven-results-summary { font-size: 12px; color: var(--pn-color-text-secondary); }
.quick-tags { gap: 8px; }
.wallhaven-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px; align-content: start; }
.wallhaven-thumbnail { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; }
.wallhaven-preview-trigger { display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }
.wallhaven-preview-trigger:focus-visible { outline: 2px solid var(--pn-color-accent); outline-offset: -2px; }
.wallhaven-preview { display: flex; width: min(1100px, calc(100vw - 32px)); max-height: calc(100vh - 48px); flex-direction: column; overflow: hidden; border: 1px solid rgb(255 255 255 / 12%); border-radius: 16px; background: #0b0b0f; color: #f4f4f5; outline: none; box-shadow: 0 24px 80px rgb(0 0 0 / 55%); }
.wallhaven-preview-stage { position: relative; display: grid; min-height: 240px; place-items: center; background: #000; }
.wallhaven-preview-image { grid-area: 1 / 1; display: block; max-width: 100%; max-height: calc(100vh - 140px); object-fit: contain; opacity: 0; transition: opacity .3s ease; }
.wallhaven-preview-image.is-thumb { width: 100%; opacity: 1; filter: blur(6px); }
.wallhaven-preview-image.is-loaded { opacity: 1; filter: none; }
.wallhaven-preview-loading { position: absolute; bottom: 12px; left: 50%; padding: 4px 12px; border-radius: 999px; background: rgb(0 0 0 / 60%); font-size: 12px; transform: translateX(-50%); }
.wallhaven-preview-nav, .wallhaven-preview-close { position: absolute; display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid rgb(255 255 255 / 25%); border-radius: 50%; background: rgb(0 0 0 / 50%); color: white; cursor: pointer; backdrop-filter: blur(12px); }
.wallhaven-preview-nav :deep(svg), .wallhaven-preview-close :deep(svg) { width: 24px; height: 24px; }
.wallhaven-preview-nav { top: 50%; transform: translateY(-50%); }
.wallhaven-preview-nav.is-prev { left: 12px; }
.wallhaven-preview-nav.is-next { right: 12px; }
.wallhaven-preview-nav:disabled { cursor: default; opacity: .3; }
.wallhaven-preview-close { top: 12px; right: 12px; }
.wallhaven-preview-nav:focus-visible, .wallhaven-preview-close:focus-visible { outline: 2px solid var(--pn-color-accent); }
.wallhaven-preview-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; }
.wallhaven-preview-retry { margin-left: 8px; padding: 1px 10px; border: 1px solid rgb(255 255 255 / 40%); border-radius: 999px; color: white; cursor: pointer; }
.wallhaven-preview-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; font-size: 13px; color: #d4d4d8; }
.wallhaven-preview-meta strong { color: #34d399; }
.wallhaven-preview-meta span { display: inline-flex; align-items: center; gap: 4px; }
.wallhaven-preview-meta a { color: #a1a1aa; text-decoration: underline; }
.wallhaven-preview-credit { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-tabs { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
.provider-tabs .provider-tab { flex: none; padding: 6px 14px; font-size: 12px; white-space: nowrap; }
.extra-filters { grid-template-columns: minmax(150px, 1fr) minmax(200px, 1.3fr); }
.favorites-empty a { text-decoration: underline; }
.wallhaven-preview-actions { display: flex; gap: 8px; }
@container (max-width: 720px) {
  .wallhaven-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .wallhaven-filters > :last-child { grid-column: 1 / -1; }
}
@container (max-width: 580px) {
  .wallhaven-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
}
@container (max-width: 300px) {
  .wallhaven-grid { grid-template-columns: 1fr; }
}

/* 选中态用亮一级的磨砂玻璃（白色高光 + 细边 + 柔和投影），日夜共用一套结构，
   不依赖 accent：默认主题的 accent 是近黑色，铺满按钮会显得很重。 */
.gallery-selector {
  --gs-chip-bg: rgba(255, 255, 255, .26);
  --gs-chip-border: rgba(255, 255, 255, .42);
  --gs-chip-text: var(--pn-color-text-secondary, #475569);
  --gs-chip-hover-bg: rgba(255, 255, 255, .46);
  --gs-chip-active-bg: rgba(255, 255, 255, .88);
  --gs-chip-active-border: rgba(255, 255, 255, .95);
  --gs-chip-active-text: var(--pn-color-text-primary, #171717);
  --gs-chip-active-shadow: 0 1px 2px rgba(15, 23, 42, .06), 0 6px 16px rgba(15, 23, 42, .1), inset 0 1px 0 rgba(255, 255, 255, .9);
}
.dark .gallery-selector {
  --gs-chip-bg: rgba(255, 255, 255, .06);
  --gs-chip-border: rgba(255, 255, 255, .1);
  --gs-chip-hover-bg: rgba(255, 255, 255, .12);
  --gs-chip-active-bg: rgba(255, 255, 255, .2);
  --gs-chip-active-border: rgba(255, 255, 255, .3);
  --gs-chip-active-text: #fff;
  --gs-chip-active-shadow: 0 6px 18px rgba(0, 0, 0, .28), inset 0 1px 0 rgba(255, 255, 255, .22);
}

.source-tab-btn, .tag-btn {
  border: 1px solid var(--gs-chip-border);
  border-radius: 9999px;
  background: var(--gs-chip-bg);
  color: var(--gs-chip-text);
  cursor: pointer;
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  backdrop-filter: blur(12px) saturate(140%);
  transition: background-color .18s ease, border-color .18s ease, color .18s ease, box-shadow .18s ease;
}
.source-tab-btn:hover:not(.active), .tag-btn:hover:not(.active):not(:disabled) {
  background: var(--gs-chip-hover-bg);
  color: var(--gs-chip-active-text);
}
.source-tab-btn.active, .tag-btn.active {
  border-color: var(--gs-chip-active-border);
  background: var(--gs-chip-active-bg);
  color: var(--gs-chip-active-text);
  font-weight: 600;
  box-shadow: var(--gs-chip-active-shadow);
}
.source-tab-btn:focus-visible, .tag-btn:focus-visible { outline: 2px solid var(--gs-chip-active-text); outline-offset: 2px; }
.tag-btn:disabled { cursor: not-allowed; opacity: .45; }

.source-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
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
  font-size: 11px;
}

/* 搜索按钮与选中态同材质，避免一整块黑色压住磨砂面板 */
.wallhaven-search-btn {
  --n-color: var(--gs-chip-active-bg) !important;
  --n-color-hover: var(--gs-chip-active-bg) !important;
  --n-color-pressed: var(--gs-chip-hover-bg) !important;
  --n-color-focus: var(--gs-chip-active-bg) !important;
  --n-text-color: var(--gs-chip-active-text) !important;
  --n-text-color-hover: var(--gs-chip-active-text) !important;
  --n-text-color-pressed: var(--gs-chip-active-text) !important;
  --n-text-color-focus: var(--gs-chip-active-text) !important;
  --n-border: 1px solid var(--gs-chip-active-border) !important;
  --n-border-hover: 1px solid var(--gs-chip-active-border) !important;
  --n-border-pressed: 1px solid var(--gs-chip-active-border) !important;
  --n-border-focus: 1px solid var(--gs-chip-active-border) !important;
  font-weight: 600;
}
</style>
