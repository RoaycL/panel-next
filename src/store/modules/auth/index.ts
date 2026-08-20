import { defineStore } from 'pinia'
import axios from 'axios'
import { getStorage, removeToken as hRemoveToken, setStorage } from './helper'
import { VisitMode } from '@/enums/auth'
import { getRuntime } from '@/runtime'
import { useAppStore } from '@/store/modules/app'
import { getDeviceIdentity } from '@/runtime/device'

// interface SessionResponse {
//   auth: boolean
// }

export interface AuthState {
  token: string | null
  refreshToken: string | null
  authMode: 'legacy' | 'device'
  accessExpiresAt: string | null
  refreshExpiresAt: string | null
  userInfo: User.Info | null
  // session: SessionResponse | null
  visitMode: VisitMode
}

function defaultState(): AuthState {
  return {
    token: null,
    refreshToken: null,
    authMode: 'legacy',
    accessExpiresAt: null,
    refreshExpiresAt: null,
    userInfo: null,
    visitMode: VisitMode.VISIT_MODE_LOGIN,
  }
}

function initialState(): AuthState {
  const stored = getStorage() as Partial<AuthState> | null
  return { ...defaultState(), ...(stored ?? {}) }
}

let refreshPromise: Promise<boolean> | null = null

export const useAuthStore = defineStore('auth-store', {
  state: (): AuthState => initialState(),

  actions: {
    setToken(token: string) {
      this.token = token
      this.refreshToken = null
      this.authMode = 'legacy'
      this.accessExpiresAt = null
      this.refreshExpiresAt = null
      this.saveStorage()
    },

    setDeviceSession(session: Login.DeviceSessionLoginResponse) {
      this.token = session.accessToken
      this.refreshToken = session.refreshToken
      this.authMode = 'device'
      this.accessExpiresAt = session.accessExpiresAt
      this.refreshExpiresAt = session.refreshExpiresAt
      this.userInfo = session.user
      this.saveStorage()
    },

    updateDeviceSession(session: Login.DeviceSessionRefreshResponse) {
      this.token = session.accessToken
      this.refreshToken = session.refreshToken
      this.accessExpiresAt = session.accessExpiresAt
      this.refreshExpiresAt = session.refreshExpiresAt
      this.saveStorage()
    },

    async refreshSession(): Promise<boolean> {
      if (this.authMode !== 'device' || !this.refreshToken)
        return false
      if (refreshPromise)
        return refreshPromise

      const refreshToken = this.refreshToken
      const performRefresh = async () => {
        try {
          const { getDeviceIdentity } = await import('@/runtime/device')
          const deviceIdentity = getDeviceIdentity()
          const response = await axios.post(
            `${getRuntime().getApiBaseUrl()}/api/v1/sessions/refresh`,
            { refreshToken, ...deviceIdentity },
            { headers: { lang: useAppStore().language } },
          )
          const data = response.data
          if (data.code !== 0 || !data.data) {
            this.clearSession()
            return false
          }
          this.updateDeviceSession(data.data)
          return true
        }
        catch {
          this.clearSession()
          return false
        }
      }

      refreshPromise = navigator.locks
        ? navigator.locks.request('panel-next-device-session-refresh', performRefresh)
        : performRefresh()

      try {
        return await refreshPromise
      }
      finally {
        refreshPromise = null
      }
    },

    async upgradeLegacyExtensionSession(): Promise<boolean> {
      const runtime = getRuntime()
      if (runtime.kind !== 'extension' || this.authMode !== 'legacy' || !this.token)
        return true
      const legacyToken = this.token
      try {
        const response = await axios.post(
          `${runtime.getApiBaseUrl()}/v1/sessions/upgrade`,
          getDeviceIdentity(),
          {
            headers: {
              'Authorization': `Bearer ${legacyToken}`,
              'token': legacyToken,
              'X-Panel-API-Version': '1',
            },
          },
        )
        const payload = response.data as { code: number; data?: Login.DeviceSessionLoginResponse }
        if (payload.code !== 0 || !payload.data) {
          if ([1000, 1001, 1009].includes(payload.code))
            this.removeToken()
          return false
        }
        if (this.authMode !== 'legacy' || this.token !== legacyToken)
          return false
        this.setDeviceSession(payload.data)
        await runtime.storage.flush?.()
        return true
      }
      catch {
        return false
      }
    },

    setUserInfo(userInfo: User.Info) {
      this.userInfo = userInfo
      this.saveStorage()
    },

    setVisitMode(visitMode: VisitMode) {
      this.visitMode = visitMode
      this.saveStorage()
    },

    saveStorage() {
      setStorage(this.$state)
    },

    removeToken() {
      this.$state = defaultState()
      hRemoveToken()
    },

    // AUTH-02: 清除当前会话，不保留失效凭据，避免重复账号记录
    clearSession() {
      this.$state = defaultState()
      hRemoveToken()
    },
  },

})
