import { post } from '@/utils/request'
import { mutationPost } from './mutation'

export function addMultiple<T>(req: Panel.ItemInfo[]) {
  return mutationPost<T>('/panel/itemIcon/addMultiple', req)
}

export function edit<T>(req: Panel.ItemInfo, queueOnFailure = true) {
  return mutationPost<T>('/panel/itemIcon/edit', req, { queueOnFailure })
}

// export function getInfo<T>(id: number) {
//   return post<T>({
//     url: '/aiApplet/getInfo',
//     data: { id },
//   })
// }

export function getListByGroupId<T>(itemIconGroupId: number | undefined) {
  return post<T>({
    url: '/panel/itemIcon/getListByGroupId',
    data: { itemIconGroupId },
  })
}

export function deletes<T>(ids: number[], queueOnFailure = true) {
  return mutationPost<T>('/panel/itemIcon/deletes', { ids }, { queueOnFailure })
}

export function saveSort<T>(data: Panel.ItemIconSortRequest, queueOnFailure = true) {
  return mutationPost<T>('/panel/itemIcon/saveSort', data, { queueOnFailure })
}

export function getSiteFavicon<T>(url: string) {
  return post<T>({
    url: '/panel/itemIcon/getSiteFavicon',
    data: { url },
  })
}
