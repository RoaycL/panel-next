import { post } from '@/utils/request'

export function getAuthInfo<T>() {
  return post<T>({
    url: '/user/getAuthInfo',
  })
}

export function updateInfo<T>(dataOrName: string | { name: string; headImage?: string }) {
  const data = typeof dataOrName === 'string' ? { name: dataOrName } : dataOrName
  return post<T>({
    url: '/user/updateInfo',
    data,
  })
}

export function updatePassword<T>(oldPassword: string, newPassword: string) {
  return post<T>({
    url: '/user/updatePassword',
    data: { newPassword, oldPassword },
  })
}
