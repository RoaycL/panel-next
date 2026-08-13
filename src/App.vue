<script setup lang="ts">
import { NConfigProvider } from 'naive-ui'
import { NaiveProvider } from '@/components/common'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/hooks/useLanguage'
import { handleRuntimeLink } from '@/runtime/navigation'

const { theme, themeOverrides } = useTheme()
const { language } = useLanguage()
</script>

<template>
  <NConfigProvider
    :theme="theme"
    :theme-overrides="themeOverrides"
    :locale="language"
  >
    <div class="h-full" @click.capture="handleRuntimeLink" @auxclick.capture="handleRuntimeLink">
      <NaiveProvider>
        <RouterView />
      </NaiveProvider>
    </div>
  </NConfigProvider>
</template>
