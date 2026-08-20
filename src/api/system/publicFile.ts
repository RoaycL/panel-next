import { post } from '@/utils/request'

export function getList<T>(type?: string) {
  return post<T>({
    url: '/publicFile/getList',
    data: type ? { type } : {},
  })
}

export function deletes<T>(ids: number[]) {
  return post<T>({
    url: '/publicFile/deletes',
    data: { ids },
  })
}

export function updateType<T>(id: number, type: string) {
  return post<T>({
    url: '/publicFile/updateType',
    data: { id, type },
  })
}
