import type { App } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHashHistory } from 'vue-router'
import { setupPageGuard } from './permission'

// Use the build-time constant directly so Rollup can remove the other
// platform's dashboard instead of emitting both entry chunks.
const homeComponent = __PANEL_RUNTIME__ === 'extension'
  ? () => import('@/views/extension/index.vue')
  : () => import('@/views/home/index.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: homeComponent,
  },

  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/index.vue'),
  },

  {
    path: '/404',
    name: '404',
    component: () => import('@/views/exception/404/index.vue'),
  },

  {
    path: '/500',
    name: '500',
    component: () => import('@/views/exception/500/index.vue'),
  },

  {
    path: '/:pathMatch(.*)*',
    name: 'notFound',
    redirect: '/404',
  },

  // adminRouter,
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ left: 0, top: 0 }),
})

setupPageGuard(router)

export async function setupRouter(app: App) {
  app.use(router)
  await router.isReady()
}
