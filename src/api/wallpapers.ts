import { get } from '@/utils/request'

// Wallhaven 之外的在线壁纸源，统一由服务端 /v1/widgets/wallpapers 代理
export type WallpaperProvider = 'wallhaven' | 'bing' | 'unsplash' | 'pexels' | 'konachan' | 'yandere'
export type ExtraWallpaperProvider = Exclude<WallpaperProvider, 'wallhaven'>

export interface OnlineWallpaperItem {
  id: string
  url: string
  rawUrl: string
  thumbUrl: string
  resolution: string
  category: string
  favorites: number
  title?: string
  author?: string
  authorUrl?: string
}

export interface OnlineWallpaperResponse {
  items: OnlineWallpaperItem[]
  meta: { currentPage: number, lastPage: number, perPage: number, total: number }
  fetchedAt: string
  cached: boolean
}

export interface OnlineWallpaperParams {
  source: ExtraWallpaperProvider
  q?: string
  purity?: string
  sorting?: string
  page?: number
}

export interface WallpaperProviderInfo {
  value: WallpaperProvider
  label: string
  /** 需要用户自己的 API Key（保存在本机） */
  keyUrl?: string
  searchable: boolean
  searchPlaceholder?: string
  /** Konachan / yande.re 的 SFW / Sketchy / NSFW 分级 */
  ratings?: boolean
  sortingOptions?: { label: string, value: string }[]
  quickTags?: { label: string, q: string }[]
  /** 卡片右上角的数字：喜欢数 / 评分 */
  scoreLabel?: string
}

const photoTags = [
  { label: '🌟 精选推荐', q: '' },
  { label: '🌄 自然风光', q: 'nature landscape' },
  { label: '🏔️ 雪山', q: 'mountains' },
  { label: '🌊 海洋', q: 'ocean' },
  { label: '🌌 星空', q: 'night sky stars' },
  { label: '🏙️ 城市夜景', q: 'city night' },
  { label: '🍂 秋天', q: 'autumn' },
  { label: '💻 极简', q: 'minimal' },
]

const booruSorting = [
  { label: '最新上传', value: 'date' },
  { label: '评分最高', value: 'score' },
  { label: '随机发现', value: 'random' },
]

// Booru 站按英文标签检索，多个标签用空格分隔
const booruTags = [
  { label: '🌟 全部', q: '' },
  { label: '🌄 风景', q: 'scenic' },
  { label: '🌌 星空', q: 'stars' },
  { label: '☁️ 天空', q: 'sky' },
  { label: '🌸 樱花', q: 'cherry_blossoms' },
  { label: '🌃 夜景', q: 'night' },
  { label: '🎨 原创', q: 'original' },
]

export const wallpaperProviders: WallpaperProviderInfo[] = [
  { value: 'wallhaven', label: 'Wallhaven', keyUrl: 'https://wallhaven.cc/settings/account', searchable: true },
  { value: 'bing', label: 'Bing 每日', searchable: false },
  {
    value: 'unsplash',
    label: 'Unsplash',
    keyUrl: 'https://unsplash.com/oauth/applications',
    searchable: true,
    searchPlaceholder: '搜索摄影作品，英文关键词效果更好…',
    sortingOptions: [{ label: '最受欢迎', value: 'popular' }, { label: '最新发布', value: 'latest' }],
    quickTags: photoTags,
    scoreLabel: '喜欢',
  },
  {
    value: 'pexels',
    label: 'Pexels',
    keyUrl: 'https://www.pexels.com/api/new/',
    searchable: true,
    searchPlaceholder: '搜索摄影作品，英文关键词效果更好…',
    quickTags: photoTags,
  },
  {
    value: 'konachan',
    label: 'Konachan',
    searchable: true,
    searchPlaceholder: '按英文标签搜索，如 scenic、original，空格分隔',
    ratings: true,
    sortingOptions: booruSorting,
    quickTags: booruTags,
    scoreLabel: '评分',
  },
  {
    value: 'yandere',
    label: 'yande.re',
    searchable: true,
    searchPlaceholder: '按英文标签搜索，如 landscape、dress，空格分隔',
    ratings: true,
    sortingOptions: booruSorting,
    quickTags: [{ label: '🌟 全部', q: '' }, { label: '🌄 风景', q: 'landscape' }, ...booruTags.slice(2)],
    scoreLabel: '评分',
  },
]

export function getOnlineWallpapers(params: OnlineWallpaperParams, apiKey = '') {
  return get<OnlineWallpaperResponse>({
    url: '/v1/widgets/wallpapers',
    data: params,
    headers: apiKey ? { 'X-Wallpaper-Api-Key': apiKey } : undefined,
  })
}
