<script setup lang="ts">
import { computed, watch } from 'vue'
import { darkTheme, NConfigProvider } from 'naive-ui'
import NaiveProvider from '@/components/common/NaiveProvider/index.vue'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/hooks/useLanguage'
import { handleRuntimeLink } from '@/runtime/navigation'
import { getRuntime } from '@/runtime'
import { createExtensionThemeOverrides } from '@/theme/extensionTheme'
import { usePanelState } from '@/store/modules/panel'
import ThemeProvider from '@/themes/ThemeProvider.vue'
import { registerThemeStoreAccessor } from '@/themes/storage'
import { buildProviderResult, getThemePreview } from '@/themes/runtime'
import { createDefaultSelection } from '@/themes/legacyAdapter'
import { themeRegistry } from '@/themes/registry'

const { isDark: legacyIsDark } = useTheme(false)
const { language } = useLanguage()
const runtime = getRuntime()
const panelStore = usePanelState()
registerThemeStoreAccessor(() => panelStore)
const themeSelection = computed(() => panelStore.panelConfig.theme ?? null)
const effectiveThemeSelection = computed(() => themeSelection.value ?? createDefaultSelection(legacyIsDark.value ? 'dark' : 'light'))
const providerView = computed(() => buildProviderResult(
  getThemePreview() ?? effectiveThemeSelection.value,
  runtime.kind,
  themeRegistry,
))
const isDark = computed(() => providerView.value.resolvedMode === 'dark')
const theme = computed(() => isDark.value ? darkTheme : undefined)
const themeOverrides = computed(() => runtime.kind === 'extension'
  ? createExtensionThemeOverrides(providerView.value.loadResult.resolved.tokens)
  : undefined)

watch(isDark, (dark) => {
  document.documentElement.classList.toggle('dark', dark)
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
          <RouterView />
        </NaiveProvider>
      </div>
    </ThemeProvider>
  </NConfigProvider>
</template>
