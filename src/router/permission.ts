import type { Router } from 'vue-router'
import { useAuthStore } from '@/store'
import { useUserStore } from '@/store/modules/user'
import { openExtensionLogin } from '@/runtime/extensionLogin'

export function setupPageGuard(router: Router) {
  router.beforeEach(async (to, from, next) => {
    const authStore = useAuthStore()
    const userStore = useUserStore()

    // An extension tab can restore an old #/login URL. Guest mode is the
    // default entry; the form is reached explicitly from the dashboard.
    if (__PANEL_RUNTIME__ === 'extension' && to.name === 'login') {
      if (!authStore.token && from.name)
        openExtensionLogin()
      next({ name: 'Home', replace: true })
      return
    }

    // AUTH-04: 已登录用户访问登录页直接跳转首页
    if (to.name === 'login' && authStore.token) {
      next({ name: 'Home' })
      return
    }

    // Refresh near access expiry. A still-valid extension session from an
    // older release is also refreshed once so the server can upgrade it to a
    // revocable, non-expiring extension session.
    const accessExpiry = Date.parse(authStore.accessExpiresAt ?? '')
    const needsExtensionUpgrade = __PANEL_RUNTIME__ === 'extension'
      && new Date(authStore.refreshExpiresAt ?? '').getUTCFullYear() < 9999
    const cachedExtensionHome = __PANEL_RUNTIME__ === 'extension' && to.name === 'Home'
    if (!cachedExtensionHome && authStore.authMode === 'device' && authStore.token && (!Number.isFinite(accessExpiry) || accessExpiry - Date.now() < 60_000 || needsExtensionUpgrade)) {
      const refreshed = await authStore.refreshSession()
      if (!refreshed && !authStore.token) {
        // Extension 新标签页必须始终可作为访客主页打开；登录仅由用户点击头像触发。
        if (__PANEL_RUNTIME__ === 'extension' && to.name === 'Home')
          next()
        else
          next({ name: __PANEL_RUNTIME__ === 'extension' ? 'Home' : 'login' })
        return
      }
    }

    // 非管理员路由拦截
    if (userStore.userInfo.role !== 1 && to.path.includes('admin'))
      next({ name: '404' })

    else
      next()
  })
}
