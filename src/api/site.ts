import { get, post } from '@/utils/request'

export interface SiteBranding {
  siteTitle: string
  siteFavicon: string
  loginBackground: string
}

export function getSiteInfo() {
  return get<SiteBranding>({
    url: '/siteInfo',
    silentNetworkError: true,
  })
}

export function getSiteSetting() {
  return get<SiteBranding>({
    url: '/siteSetting/get',
  })
}

export function setSiteSetting(data: SiteBranding) {
  return post<SiteBranding>({
    url: '/siteSetting/set',
    data,
  })
}
