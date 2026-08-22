<script setup lang="ts">
import { computed } from 'vue'
import { NConfigProvider } from 'naive-ui'
import { NaiveProvider } from '@/components/common'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/hooks/useLanguage'
import { handleRuntimeLink } from '@/runtime/navigation'
import { getRuntime } from '@/runtime'
import { extensionThemeOverrides } from '@/theme/extensionTheme'

const { theme } = useTheme()
const { language } = useLanguage()
const runtime = getRuntime()
const themeOverrides = computed(() => runtime.kind === 'extension' ? extensionThemeOverrides : undefined)
</script>

<template>
  <NConfigProvider
    :theme="theme"
    :locale="language"
    :theme-overrides="themeOverrides"
  >
    <div class="h-full" @click.capture="handleRuntimeLink" @auxclick.capture="handleRuntimeLink">
      <NaiveProvider>
        <RouterView />
      </NaiveProvider>
    </div>
  </NConfigProvider>
</template>
