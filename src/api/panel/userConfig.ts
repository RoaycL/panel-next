import { post } from '@/utils/request'
import { mutationPost } from './mutation'

export function set<T>(req: Panel.userConfig) {
  return mutationPost<T>('/panel/userConfig/set', req)
}

export function get<T>() {
  return post<T>({
    url: '/panel/userConfig/get',
  })
}
