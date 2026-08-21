<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import {
  NButton,
  NGrid,
  NGridItem,
  NImage,
  NImageGroup,
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

const props = withDefaults(defineProps<{
  type?: string // icon/wallpaper/other/all
}>(), {
  type: 'all',
})

const emit = defineEmits<{
  (e: 'select', url: string): void
}>()

void props

const ms = useMessage()
const loading = ref(false)
const source = ref<'private' | 'public' | 'wallhaven'>('private')

// 1. 本地/公共图库
const imageList = ref<File.Info[]>([])
const activeType = ref<string>('all')

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
  { label: '🔥 最热榜单 (Toplist)', value: 'toplist' },
  { label: '⚡ 近期热门 (Hot)', value: 'hot' },
  { label: '👁️ 最多浏览 (Views)', value: 'views' },
  { label: '🎲 随机发现 (Random)', value: 'random' },
  { label: '✨ 最新上传 (Latest)', value: 'date_added' },
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
  loading.value = true
  try {
    if (source.value === 'wallhaven') {
      await fetchWallhaven()
      return
    }

    const type = activeType.value === 'all' ? undefined : activeType.value
    if (source.value === 'private') {
      const { data } = await getPrivateList<Common.ListResponse<File.Info[]>>(type)
      imageList.value = data.list || []
    }
    else {
      const { data } = await getPublicList<Common.ListResponse<File.Info[]>>(type)
      imageList.value = data.list || []
    }
  }
  finally {
    loading.value = false
  }
}

async function fetchWallhaven() {
  loading.value = true
  try {
    const params: WallhavenSearchParams = {
      q: wallhavenQuery.value.trim() || undefined,
      categories: wallhavenCategories.value,
      purity: '100', // SFW 安全内容
      sorting: wallhavenSorting.value,
      topRange: '1M',
      atleast: '1920x1080',
      ratios: '16x9,16x10',
      page: wallhavenPage.value,
    }
    const res = await getWallhavenWallpapers(params)
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
    ms.error('请求 Wallhaven 服务失败')
  }
  finally {
    loading.value = false
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

function handleSelect(url: string) {
  emit('select', url)
  ms.success('已选择壁纸')
}

watch(source, () => {
  if (source.value === 'wallhaven' && wallhavenList.value.length === 0) {
    void fetchWallhaven()
  }
  else if (source.value !== 'wallhaven') {
    void fetchImages()
  }
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
        <button
          type="button"
          class="source-tab-btn"
          :class="{ active: source === 'private' }"
          @click="source = 'private'"
        >
          <SvgIcon icon="material-symbols:folder-shared-outline" class="text-sm" />
          <span>{{ $t('apps.uploadsFileManager.alertText').includes('文件') ? '个人图库' : 'Private Gallery' }}</span>
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
        v-if="source !== 'wallhaven'"
        v-model:value="activeType"
        :options="sourceOptions"
        size="small"
        style="width: 140px"
        @update-value="fetchImages"
      />
    </div>

    <!-- Wallhaven 专属快捷工具栏 -->
    <div v-if="source === 'wallhaven'" class="wallhaven-toolbar mb-3 flex flex-col gap-2">
      <!-- 搜索与排序 -->
      <div class="flex items-center gap-2 flex-wrap">
        <NInputGroup style="max-width: 320px;">
          <NInput
            v-model:value="wallhavenQuery"
            size="small"
            placeholder="搜索 4K 壁纸 (英文/中文)..."
            clearable
            @keydown.enter="handleWallhavenSearch"
          />
          <NButton size="small" type="primary" @click="handleWallhavenSearch">
            <template #icon>
              <SvgIcon icon="material-symbols:search-rounded" />
            </template>
            搜索
          </NButton>
        </NInputGroup>

        <NSelect
          v-model:value="wallhavenSorting"
          :options="wallhavenSortingOptions"
          size="small"
          style="width: 170px"
          @update-value="handleWallhavenSearch"
        />

        <span v-if="wallhavenTotal > 0" class="text-xs text-slate-500 dark:text-zinc-400 ml-auto">
          找到约 {{ wallhavenTotal }} 张壁纸
        </span>
      </div>

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
    </div>

    <!-- 主体内容加载 -->
    <div v-if="loading" class="flex-1 flex items-center justify-center py-16">
      <NSpin size="medium" description="正在加载高清壁纸..." />
    </div>

    <!-- 1. 本地/公共图库网格 -->
    <div v-else-if="source !== 'wallhaven'" class="flex-1">
      <div v-if="imageList.length === 0" class="text-center text-slate-400 py-12">
        {{ t('apps.uploadsFileManager.nothingText') }}
      </div>

      <NImageGroup v-else>
        <NGrid cols="2 300:2 600:4 900:6 1100:8" :x-gap="8" :y-gap="8">
          <NGridItem v-for="item in imageList" :key="item.id">
            <div
              class="gallery-item-card group cursor-pointer rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-800 hover:border-emerald-500 transition-all hover:shadow-md"
              @click="handleSelect(item.src)"
            >
              <NImage
                :src="item.src"
                :lazy="true"
                object-fit="cover"
                height="90"
                class="w-full"
                preview-disabled
              />
              <div class="p-1.5 text-xs truncate text-center bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                {{ item.fileName }}
              </div>
            </div>
          </NGridItem>
        </NGrid>
      </NImageGroup>
    </div>

    <!-- 2. Wallhaven 壁纸网格 -->
    <div v-else class="flex-1 flex flex-col">
      <div v-if="wallhavenList.length === 0" class="text-center text-slate-400 py-12">
        未找到相关壁纸，换个关键词试试吧
      </div>

      <div v-else class="wallhaven-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 flex-1">
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
            class="w-full h-32 object-cover transition-transform duration-500 group-hover:scale-105"
          >

          <!-- 分辨率与分类浮层徽标 -->
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
  background: white;
  min-height: 480px;
}

.dark .gallery-selector {
  background: #18181c;
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
  padding: 3px 10px;
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
