import { createApp } from 'vue'
import App from './App.vue'
import { setupI18n } from './locales'
import { setupAssets, setupScrollbarStyle } from './plugins'
import { setupStore, useAuthStore } from './store'
import { setupRouter } from './router'
import { getRuntime } from './runtime'
import 'virtual:svg-icons-register' // svg图标注册

async function bootstrap() {
  const runtime = getRuntime()
  await runtime.ready()
  const rootComponent = runtime.kind === 'extension'
    ? (await import('./runtime/ExtensionRoot.vue')).default
    : App
  const app = createApp(rootComponent)
  setupAssets()

  setupScrollbarStyle()

  setupStore(app)

  if (runtime.kind === 'extension')
    await useAuthStore().upgradeLegacyExtensionSession()

  setupI18n(app)

  if (runtime.kind === 'web' || runtime.getServerOrigin())
    await setupRouter(app)
  app.mount('#app')
}

bootstrap()
