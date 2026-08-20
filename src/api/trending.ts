import type { Response } from '@/utils/request'
import { get } from '@/utils/request'

export const TRENDING_SOURCES = ['weibo', 'baidu', 'zhihu', 'hackernews'] as const

export type TrendingSource = typeof TRENDING_SOURCES[number]

export interface TrendingItem {
  rank: number
  title: string
  url: string
  score?: number
}

export interface TrendingResponse {
  source: TrendingSource
  items: TrendingItem[]
  fetchedAt: string
  cached: boolean
  stale: boolean
}

export function getTrending(source: TrendingSource, limit = 10, signal?: AbortSignal) {
  return get<TrendingResponse>({
    url: '/v1/widgets/trending',
    data: { source, limit },
    signal,
    silentNetworkError: true,
  })
}

export type TrendingResponsePayload = Response<TrendingResponse>
