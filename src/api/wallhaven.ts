import { get } from '@/utils/request'

export interface WallhavenItem {
  id: string
  url: string
  rawUrl: string
  thumbUrl: string
  resolution: string
  category: string
  fileSize: number
  colors: string[]
  views: number
  favorites: number
}

export interface WallhavenMeta {
  currentPage: number
  lastPage: number
  perPage: number
  total: number
}

export interface WallhavenResponse {
  items: WallhavenItem[]
  meta: WallhavenMeta
  fetchedAt: string
  cached: boolean
}

export interface WallhavenSearchParams {
  q?: string
  categories?: string // '110' (General+Anime), '100', '010', '111'
  purity?: string // '100' (SFW)
  sorting?: 'toplist' | 'hot' | 'views' | 'random' | 'date_added'
  order?: 'desc' | 'asc'
  topRange?: '1d' | '3d' | '1w' | '1M' | '1y'
  atleast?: string
  ratios?: string
  page?: number
}

export function getWallhavenWallpapers(params: WallhavenSearchParams = {}) {
  return get<WallhavenResponse>({
    url: '/v1/widgets/wallhaven',
    data: params,
  })
}
