import { get, post } from '@/utils/request'

export function getAccountSettings() {
  return get<{ openRegister: boolean }>({ url: '/v1/accounts/settings' })
}

export function setAccountSettings(openRegister: boolean) {
  return post<{ openRegister: boolean }>({ url: '/v1/accounts/settings', data: { openRegister } })
}

export function getAuthInfo<T>() {
  return post<T>({
    url: '/user/getAuthInfo',
  })
}

export function updateInfo<T>(dataOrName: string | { name: string; headImage?: string; mail?: string }) {
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
