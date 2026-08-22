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
  retryAfterSeconds?: number
}

export class HttpRequestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message)
    this.name = 'HttpRequestError'
  }
}

export function isInternalApiPath(url: unknown): url is string {
  if (typeof url !== 'string')
    return false
  if (!url.startsWith('/') || url.startsWith('//'))
    return false
  // Reject backslashes and ASCII control characters (0-31 and 127)
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001F\u007F]/.test(url))
    return false
  return true
}

export function assertInternalApiPath(url: unknown): asserts url is string {
  if (!isInternalApiPath(url)) {
    throw new HttpRequestError(
      `Invalid internal API path "${url}". Project request layer only accepts paths starting with a single "/".`,
      false,
      400,
    )
  }
}

function isBusinessResponse(data: unknown): data is { code: number; msg?: string } {
  return typeof data === 'object' && data !== null && 'code' in data && typeof (data as any).code === 'number'
}

function http<T = any>(options: HttpOption, sessionRetry = false): Promise<Response<T>> {
  const { url, data, headers: providedHeaders, onDownloadProgress, signal, beforeRequest, afterRequest, silentNetworkError } = options
  assertInternalApiPath(url)

  let { method } = options
  const authStore = useAuthStore()
  const appStore = useAppStore()
  const successHandler = async (res: AxiosResponse<Response<T>>): Promise<Response<T>> => {
    if (res.data.code === 0)
      return res.data

    if (res.data.code === 1600) {
      const retryAfter = Number.parseInt(String(res.headers['retry-after'] ?? ''), 10)
      return {
        ...res.data,
        retryAfterSeconds: Number.isSafeInteger(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      }
    }

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
      return Promise.reject(new HttpRequestError(res.data.msg || 'Business Error', false, 200))
    else
      return res.data
  }

  const failHandler = (error: unknown) => {
    afterRequest?.()
    if (error instanceof HttpRequestError) {
      if (error.retryable && !silentNetworkError) {
        message.error(t('common.networkError'), {
          duration: 50000,
          closable: true,
        })
      }
      throw error
    }

    if (isBusinessResponse(error)) {
      throw new HttpRequestError(error.msg || 'Business Error', false, 200)
    }

    const isAxios = axios.isAxiosError(error)
    const isTimeout = (signal as any)?.reason?.name === 'TimeoutError'
      || (error instanceof Error && (error.name === 'TimeoutError' || error.message.toLowerCase().includes('timeout')))
    const isCanceled = (axios.isCancel(error) || (isAxios && error.code === 'ERR_CANCELED')) && !isTimeout
    const status = isAxios ? error.response?.status : undefined
    const retryable = isTimeout || (!isCanceled && (status === undefined || status >= 500))

    if (!silentNetworkError && !isCanceled && retryable) {
      message.error(t('common.networkError'), {
        duration: 50000,
        closable: true,
      })
    }
    const messageText = isAxios
      ? String(error.response?.data?.msg || error.message || 'Error')
      : error instanceof Error ? error.message : 'Error'
    throw new HttpRequestError(messageText, retryable, status)
  }

  beforeRequest?.()

  method = method || 'GET'

  const params = Object.assign(typeof data === 'function' ? data() : data ?? {}, {})
  const headers: Record<string, any> = {
    ...(providedHeaders ?? {}),
    token: authStore.token,
    lang: appStore.language,
  }
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
