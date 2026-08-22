import type { AxiosResponse } from 'axios'
import axios from 'axios'
import { getRuntime } from '@/runtime'
import { useAuthStore } from '@/store'

const service = axios.create()

service.interceptors.request.use(
  (config) => {
    const url = config.url ?? ''
    // Defensive check: reject external, protocol-relative, backslash, or control char URLs
    // eslint-disable-next-line no-control-regex
    if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || /[\\\u0000-\u001F\u007F]/.test(url)) {
      throw new Error(`Forbidden request to external or invalid URL "${url}" in project Axios layer.`)
    }
    config.baseURL = getRuntime().getApiBaseUrl()
    const token = useAuthStore().token
    if (token)
      config.headers.Authorization = `Bearer ${token}`
    return config
  },
  (error) => {
    return Promise.reject(error.response || error)
  },
)

service.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => {
    if (response.status === 200)
      return response

    throw new Error(response.status.toString())
  },
  (error) => {
    return Promise.reject(error)
  },
)

export default service
