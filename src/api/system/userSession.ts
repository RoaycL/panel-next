import { post } from '@/utils/request'

export interface SessionInfo {
  id: string
  deviceName: string
  clientType: 'web' | 'chrome_extension'
  createdAt: string
  lastActiveAt: string
  refreshExpiresAt: string
  current: boolean
}

export function getSessionList<T>() {
  return post<T>({
    url: '/user/session/getList',
  })
}

export function revokeSession<T>(sessionId: string) {
  return post<T>({
    url: '/user/session/revoke',
    data: { sessionId },
  })
}

export function revokeAllSessions<T>() {
  return post<T>({
    url: '/user/session/revokeAll',
  })
}
