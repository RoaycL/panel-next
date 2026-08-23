<script setup lang="ts">
import { computed } from 'vue'
import { NConfigProvider } from 'naive-ui'
import { NaiveProvider } from '@/components/common'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/hooks/useLanguage'
import { handleRuntimeLink } from '@/runtime/navigation'
import { getRuntime } from '@/runtime'
import { extensionThemeOverrides } from '@/theme/extensionTheme'
import { usePanelState } from '@/store/modules/panel'
import { ThemeProvider, registerThemeStoreAccessor } from '@/themes'

const { theme } = useTheme()
const { language } = useLanguage()
const runtime = getRuntime()
const themeOverrides = computed(() => runtime.kind === 'extension' ? extensionThemeOverrides : undefined)
const panelStore = usePanelState()
registerThemeStoreAccessor(() => panelStore)
const themeSelection = computed(() => panelStore.panelConfig.theme ?? null)
</script>

<template>
  <NConfigProvider
    :theme="theme"
    :locale="language"
    :theme-overrides="themeOverrides"
  >
    <ThemeProvider :surface="runtime.kind" :selection="themeSelection">
      <div class="h-full" @click.capture="handleRuntimeLink" @auxclick.capture="handleRuntimeLink">
        <NaiveProvider>
          <RouterView />
        </NaiveProvider>
      </div>
    </ThemeProvider>
  </NConfigProvider>
</template>
