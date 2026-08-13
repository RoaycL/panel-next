import { defineStore } from 'pinia'
import axios from 'axios'
import { getStorage, removeToken as hRemoveToken, setStorage } from './helper'
import { VisitMode } from '@/enums/auth'
import { getRuntime } from '@/runtime'
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
        await getRuntime().storage.flush?.()
        await getRuntime().storage.sync?.()
        const latest = getStorage() as Partial<AuthState> | null
        if (latest?.authMode === 'device' && latest.refreshToken && latest.refreshToken !== refreshToken && latest.token) {
          this.token = latest.token
          this.refreshToken = latest.refreshToken
          this.accessExpiresAt = latest.accessExpiresAt ?? null
          this.refreshExpiresAt = latest.refreshExpiresAt ?? null
          return true
        }
        if (this.authMode !== 'device' || this.refreshToken !== refreshToken)
          return false
        try {
          const response = await axios.post(
            `${getRuntime().getApiBaseUrl()}/v1/sessions/refresh`,
            { refreshToken },
            { headers: { 'X-Panel-API-Version': '1' } },
          )
          const payload = response.data as { code: number; data?: Login.DeviceSessionRefreshResponse }
          if (payload.code !== 0 || !payload.data)
            return false
          if (this.authMode !== 'device' || this.refreshToken !== refreshToken)
            return false
          this.updateDeviceSession(payload.data)
          await getRuntime().storage.flush?.()
          return true
        }
        catch {
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
  },

})
