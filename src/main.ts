import { createApp } from 'vue'
import App from './App.vue'
import { setupI18n } from './locales'
import { setupAssets, setupScrollbarStyle } from './plugins'
import { setupStore } from './store'
import { setupRouter } from './router'
import { getRuntime } from './runtime'
import 'virtual:svg-icons-register' // svg图标注册
import { initializePackages } from '@/packages/manager'
import { initializeExtensionUpdates } from '@/runtime/extensionUpdates'
import { canReadExtensionImage } from '@/runtime/extension'
import { configureIconCachePermission } from '@/icons/localImageCache'
import { installModalFocusGuard } from '@/plugins/modalFocus'
import { initializeSharedSettings } from '@/runtime/sharedSettings'

async function bootstrap() {
  const runtime = getRuntime()
  await runtime.ready()
  if (runtime.kind === 'extension') configureIconCachePermission(canReadExtensionImage)
  if (runtime.kind === 'extension') initializeExtensionUpdates()
  initializePackages()
  // Shared material rules also cover overlays teleported outside the theme root.
  document.body.dataset.panelRuntime = runtime.kind
  const app = createApp(App)
  installModalFocusGuard(app)
  setupAssets()

  setupScrollbarStyle()

  setupStore(app)
  initializeSharedSettings()

  setupI18n(app)

  await setupRouter(app)
  app.mount('#app')
}

bootstrap()
