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
