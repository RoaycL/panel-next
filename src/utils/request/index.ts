import axios from 'axios'
import type { AxiosProgressEvent, AxiosResponse, GenericAbortSignal } from 'axios'
import request from './axios'
import { apiRespErrMsg, message } from './apiMessage'
import { t } from '@/locales'
import { useAppStore, useAuthStore } from '@/store'
import { router } from '@/router'
import { getRuntime } from '@/runtime'

let loginMessageShow = false
export interface HttpOption {
  url: string
  data?: any
  method?: string
  headers?: any
  onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void
  signal?: GenericAbortSignal
  beforeRequest?: () => void
  afterRequest?: () => void
  silentNetworkError?: boolean
}

export interface Response<T = any> {
  data: T
  // message: string | null
  // status: string
  msg: string
  code: number
  queued?: boolean
  conflict?: boolean
}

export class HttpRequestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message)
    this.name = 'HttpRequestError'
  }
}

function http<T = any>(options: HttpOption, sessionRetry = false): Promise<Response<T>> {
  const { url, data, headers: providedHeaders, onDownloadProgress, signal, beforeRequest, afterRequest, silentNetworkError } = options
  let { method } = options
  let headers = providedHeaders
  const authStore = useAuthStore()
  const appStore = useAppStore()
  const successHandler = async (res: AxiosResponse<Response<T>>): Promise<Response<T>> => {
    if (res.data.code === 0)
      return res.data

    if (res.data.code === 1008 && !sessionRetry) {
      if (await authStore.refreshSession())
        return http<T>(options, true)
      // Preserve a device refresh token after a temporary refresh transport
      // failure. A later online event/request can recover the same session.
      if (authStore.authMode === 'device' && authStore.refreshToken)
        return res.data
    }

    if (res.data.code === 1001 || res.data.code === 1008 || res.data.code === 1009) {
      authStore.removeToken()
      if (getRuntime().kind !== 'extension') {
        // 避免重复弹窗
        if (loginMessageShow === false) {
          loginMessageShow = true
          message.warning(t('api.loginExpires'), {
            onLeave() {
              loginMessageShow = false
            },
          })
        }
        router.push({ path: '/login' })
      }
      return res.data
    }

    if (res.data.code === 1000) {
      authStore.removeToken()
      if (getRuntime().kind !== 'extension') {
        router.push({ path: '/login' })
      }
      return res.data
    }

    if (res.data.code === 1005) {
      message.warning(res.data.msg)
      return res.data
    }

    if (res.data.code === -1) {
      // message.warning(res.data.msg)
      // router.push({ path: '/login' })
      // authStore.removeToken()
      return res.data
    }

    if (!apiRespErrMsg(res.data))
      return Promise.reject(res.data)
    else
      return res.data
  }

  const failHandler = (error: unknown) => {
    afterRequest?.()
    if (!silentNetworkError) {
      message.error(t('common.networkError'), {
        duration: 50000,
        closable: true,
      })
    }
    const status = axios.isAxiosError(error) ? error.response?.status : undefined
    const messageText = axios.isAxiosError(error)
      ? String(error.response?.data?.msg || error.message || 'Error')
      : error instanceof Error ? error.message : 'Error'
    throw new HttpRequestError(messageText, status === undefined || status >= 500, status)
  }

  beforeRequest?.()

  method = method || 'GET'

  const params = Object.assign(typeof data === 'function' ? data() : data ?? {}, {})
  if (!headers)
    headers = {}

  headers.token = authStore.token
  headers.lang = appStore.language
  return method === 'GET'
    ? request.get(url, { params, headers, signal, onDownloadProgress }).then(successHandler, failHandler)
    : request.post(url, params, { headers, signal, onDownloadProgress }).then(successHandler, failHandler)
}

export function get<T = any>(
  { url, data, method = 'GET', headers, onDownloadProgress, signal, beforeRequest, afterRequest, silentNetworkError }: HttpOption,
): Promise<Response<T>> {
  return http<T>({
    url,
    method,
    data,
    headers,
    onDownloadProgress,
    signal,
    beforeRequest,
    afterRequest,
    silentNetworkError,
  })
}

export function post<T = any>(
  { url, data, method = 'POST', headers, onDownloadProgress, signal, beforeRequest, afterRequest, silentNetworkError }: HttpOption,
): Promise<Response<T>> {
  return http<T>({
    url,
    method,
    data,
    headers,
    onDownloadProgress,
    signal,
    beforeRequest,
    afterRequest,
    silentNetworkError,
  })
}

export default post
