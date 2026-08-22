import { computed, watch } from 'vue'
import { darkTheme, useOsTheme } from 'naive-ui'
import { useAppStore } from '@/store'
import { getRuntime } from '@/runtime'

export function useTheme() {
  const appStore = useAppStore()
  const runtime = getRuntime()

  const OsTheme = useOsTheme()

  const isDark = computed(() => {
    if (runtime.kind === 'extension')
      return true
    if (appStore.theme === 'auto')
      return OsTheme.value === 'dark'
    else
      return appStore.theme === 'dark'
  })

  const theme = computed(() => {
    return isDark.value ? darkTheme : undefined
  })

  watch(
    () => isDark.value,
    (dark) => {
      if (dark)
        document.documentElement.classList.add('dark')
      else
        document.documentElement.classList.remove('dark')
    },
    { immediate: true },
  )

  return { theme }
}
