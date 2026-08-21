import type { Router } from 'vue-router'
import { useAuthStore } from '@/store'
import { useUserStore } from '@/store/modules/user'

export function setupPageGuard(router: Router) {
  router.beforeEach(async (to, from, next) => {
    const authStore = useAuthStore()
    const userStore = useUserStore()

    // AUTH-04: 已登录用户访问登录页直接跳转首页
    if (to.name === 'login' && authStore.token) {
      next({ name: 'Home' })
      return
    }

    // AUTH-02: 设备会话模式下，如果 access token 过期且 refresh 也失败，
    // 自动清除会话并跳转登录页，避免重复账号记录
    if (authStore.authMode === 'device' && authStore.token && !authStore.accessExpiresAt) {
      const refreshed = await authStore.refreshSession()
      if (!refreshed) {
        next({ name: 'login' })
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
