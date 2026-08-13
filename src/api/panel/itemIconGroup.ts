import { post } from '@/utils/request'
import { mutationPost } from './mutation'

export function edit<T>(req: Panel.ItemIconGroup) {
  return mutationPost<T>('/panel/itemIconGroup/edit', req)
}

export function getList<T>() {
  return post<T>({
    url: '/panel/itemIconGroup/getList',
  })
}

export function deletes<T>(ids: number[]) {
  return mutationPost<T>('/panel/itemIconGroup/deletes', { ids })
}

export function saveSort<T>(sortItems: Common.SortItemRequest[]) {
  return mutationPost<T>('/panel/itemIconGroup/saveSort', { sortItems })
}
