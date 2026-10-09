import { get, post } from '@/utils/request'

export interface ImgbedConfig {
  configured: boolean
  baseUrl: string
  token: string
}

export interface ImgbedUploadResult {
  imageUrl: string
}

export function getImgbedConfig() {
  return get<ImgbedConfig>({ url: '/imgbed/config' })
}

export function setImgbedConfig(data: { baseUrl: string, token: string }) {
  return post<ImgbedConfig>({ url: '/imgbed/config', data })
}

export function testImgbedConfig() {
  return post({ url: '/imgbed/test' })
}

export function uploadToImgbed(file: File) {
  const formData = new FormData()
  formData.append('imgfile', file)
  return post<ImgbedUploadResult>({
    url: '/imgbed/upload',
    data: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export interface ImgbedListItem {
  name: string
  url: string
}

export function getImgbedStatus() {
  return get<{ available: boolean }>({ url: '/imgbed/status', silentNetworkError: true })
}

export function getImgbedList(page: number, limit: number) {
  return get<{ items: ImgbedListItem[], total: number }>({ url: '/imgbed/list', data: { page, limit }, timeout: 25000 })
}
