import { post } from '@/utils/request'

export interface SessionInfo {
  id: number
  deviceName: string
  clientType: 'web' | 'chrome_extension'
  createdAt: string
  lastActiveAt: string
  accessExpiresAt: string
  isActive: boolean
}

export function getSessionList<T>() {
  return post<T>({
    url: '/user/session/getList',
  })
}

export function revokeSession<T>(sessionId: number) {
  return post<T>({
    url: '/user/session/revoke',
    data: { id: sessionId },
  })
}

export function revokeAllSessions<T>() {
  return post<T>({
    url: '/user/session/revokeAll',
  })
}
