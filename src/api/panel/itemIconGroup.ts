import { post } from '@/utils/request'
import { mutationPost } from './mutation'

export function edit<T>(req: Panel.ItemIconGroup, queueOnFailure = true) {
  return mutationPost<T>('/panel/itemIconGroup/edit', req, { queueOnFailure })
}

export function getList<T>() {
  return post<T>({
    url: '/panel/itemIconGroup/getList',
  })
}

export function deletes<T>(ids: number[], queueOnFailure = true) {
  return mutationPost<T>('/panel/itemIconGroup/deletes', { ids }, { queueOnFailure })
}

export function saveSort<T>(sortItems: Common.SortItemRequest[], queueOnFailure = true) {
  return mutationPost<T>('/panel/itemIconGroup/saveSort', { sortItems }, { queueOnFailure })
}
