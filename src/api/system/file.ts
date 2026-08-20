import { post } from '@/utils/request'

export function getList<T>(type?: string) {
  return post<T>({
    url: '/file/getList',
    data: type ? { type } : {},
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
