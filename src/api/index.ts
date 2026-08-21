import { get, post } from '@/utils/request'
import { getDeviceIdentity } from '@/runtime/device'

// 登录相关

export function login<T>(data: Login.LoginReqest) {
  return post<T>({
    url: '/v1/sessions/login',
    data: { ...data, ...getDeviceIdentity() },
  })
}

export function getLoginConfig<T>() {
  return get<T>({
    url: '/openness/loginConfig',
  })
}

export function logout<T>() {
  return post<T>({
    url: '/logout',
  })
}
