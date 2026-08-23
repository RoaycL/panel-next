import { post } from '@/utils/request'

export function getList<T>(type?: string) {
  return post<T>({
    url: '/file/getList',
    data: type ? { type } : {},
    // 后台/列表加载请求：网络或 CORS 失败时静默降级，避免在不可达服务器上反复弹出错误提示。
    silentNetworkError: true,
  })
}

export function deletes<T>(ids: number[]) {
  return post<T>({
    url: '/file/deletes',
    data: { ids },
  })
}

export function updateType<T>(id: number, type: string) {
  return post<T>({
    url: '/file/updateType',
    data: { id, type },
  })
}

export interface InvalidFileInfo {
  id: number
  fileName: string
  src: string
}

export interface DeleteInvalidResult {
  deletedCount: number
  deleted: InvalidFileInfo[]
}

export function deleteInvalid<T>() {
  return post<T>({
    url: '/file/deleteInvalid',
    data: {},
  })
}
