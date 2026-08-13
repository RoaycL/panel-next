import type { Router } from 'vue-router'
import { useAuthStore } from '@/store'
import { useUserStore } from '@/store/modules/user'
import { getRuntime } from '@/runtime'

export function setupPageGuard(router: Router) {
  router.beforeEach(async (to, from, next) => {
    const authStore = useAuthStore()
    const userStore = useUserStore()
    if (getRuntime().kind === 'extension' && !authStore.token && to.name !== 'login') {
      next({ name: 'login' })
      return
    }
    // 非管理员路由拦截
    if (userStore.userInfo.role !== 1 && to.path.includes('admin'))
      next({ name: '404' })

    else
      next()
  })
}
