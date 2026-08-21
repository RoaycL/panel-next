import { post } from '@/utils/request'

export function getCpuState<T>() {
  return post<T>({
    url: '/system/monitor/getCpuState',
  })
}

export function getDiskStateByPath<T>(path: string) {
  return post<T>({
    url: '/system/monitor/getDiskStateByPath',
    data: { path },
  })
}

export function getMemoryState<T>() {
  return post<T>({
    url: '/system/monitor/getMemoryState',
  })
}

export function getDiskMountpoints<T>() {
  return post<T>({
    url: '/system/monitor/getDiskMountpoints',
  })
}
