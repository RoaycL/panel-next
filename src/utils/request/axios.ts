import type { AxiosResponse } from 'axios'
import axios from 'axios'
import { getRuntime } from '@/runtime'
import { useAuthStore } from '@/store'

const service = axios.create()

service.interceptors.request.use(
  (config) => {
    config.baseURL = getRuntime().getApiBaseUrl()
    const token = useAuthStore().token
    if (token)
      config.headers.Authorization = `Bearer ${token}`
    return config
  },
  (error) => {
    return Promise.reject(error.response)
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
