<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { darkTheme, NConfigProvider, NModal } from 'naive-ui'
import NaiveProvider from '@/components/common/NaiveProvider/index.vue'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/hooks/useLanguage'
import { handleRuntimeLink } from '@/runtime/navigation'
import { getRuntime } from '@/runtime'
import { createThemeOverrides } from '@/theme/extensionTheme'
import { usePanelState } from '@/store/modules/panel'
import ThemeProvider from '@/themes/ThemeProvider.vue'
import { registerThemeStoreAccessor } from '@/themes/storage'
import { buildProviderResult, getThemePreview } from '@/themes/runtime'
import { createDefaultSelection } from '@/themes/legacyAdapter'
import { themeRegistry } from '@/themes/registry'
import { extensionLoginVisible } from '@/runtime/extensionLogin'
import { packageRevision } from '@/packages/manager'
import ExtensionUpdateNotice from '@/components/common/ExtensionUpdateNotice.vue'
import DefaultPasswordGuard from '@/components/common/DefaultPasswordGuard.vue'

const LoginForm = defineAsyncComponent(() => import('@/views/login/index.vue'))
const extensionDashboardRevision = ref(0)
const extensionLoginBusy = ref(false)
const overlaysReady = ref(false)
onMounted(() => { overlaysReady.value = true })

function handleExtensionAuthenticated() {
  extensionLoginVisible.value = false
  // Reinitialize account-scoped bookmarks, layouts and sync without routing
  // away from the dashboard or reloading the browser tab.
  extensionDashboardRevision.value++
}

const { isDark: legacyIsDark } = useTheme(false)
const { language } = useLanguage()
const runtime = getRuntime()
const panelStore = usePanelState()
registerThemeStoreAccessor(() => panelStore)
const themeSelection = computed(() => panelStore.panelConfig.theme ?? null)
const effectiveThemeSelection = computed(() => themeSelection.value ?? createDefaultSelection(legacyIsDark.value ? 'dark' : 'light'))
const providerView = computed(() => {
  void packageRevision.value
  return buildProviderResult(getThemePreview() ?? effectiveThemeSelection.value, runtime.kind, themeRegistry)
})
const isDark = computed(() => providerView.value.resolvedMode === 'dark')
const theme = computed(() => isDark.value ? darkTheme : undefined)
// Web and extension now consume one component-token bridge. This keeps form
// controls, overlays, cards and feedback surfaces aligned with the active SDK theme.
const themeOverrides = computed(() => createThemeOverrides(providerView.value.loadResult.resolved.tokens))

watch(isDark, (dark) => {
  document.documentElement.classList.toggle('dark', dark)
}, { immediate: true })

// Menus teleported to body must follow the same tokens as the page and modals.
watch(() => providerView.value.cssVariables, (variables) => {
  for (const [key, value] of Object.entries(variables))
    document.body.style.setProperty(key, key === '--pn-effect-blur' && value === 'none' ? '0px' : value)
}, { immediate: true })
</script>

<template>
  <NConfigProvider
    :theme="theme"
    :locale="language"
    :theme-overrides="themeOverrides"
  >
    <ThemeProvider :surface="runtime.kind" :selection="effectiveThemeSelection">
      <div class="h-full" @click.capture="handleRuntimeLink" @auxclick.capture="handleRuntimeLink">
        <NaiveProvider>
          <RouterView :key="extensionDashboardRevision" />
          <ExtensionUpdateNotice v-if="runtime.kind === 'extension'" />
          <DefaultPasswordGuard v-if="overlaysReady" />
          <NModal
            v-if="runtime.kind === 'extension' && overlaysReady"
            v-model:show="extensionLoginVisible"
            to=".pn-theme-root"
            :mask-closable="false"
            :close-on-esc="!extensionLoginBusy"
            :auto-focus="true"
          >
            <LoginForm embedded @busy="extensionLoginBusy = $event" @close="extensionLoginVisible = false" @authenticated="handleExtensionAuthenticated" />
          </NModal>
        </NaiveProvider>
      </div>
    </ThemeProvider>
  </NConfigProvider>
</template>
