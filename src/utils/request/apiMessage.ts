import type { ConfigProviderProps } from 'naive-ui'
import { createDiscreteApi, darkTheme, lightTheme } from 'naive-ui'
import { computed, ref } from 'vue'
import type { Response } from './index'
import { t } from '@/locales'
import { useAppStore } from '@/store'

const themeRef = ref<'light' | 'dark'>('light')
const configProviderPropsRef = computed<ConfigProviderProps>(() => ({
  theme: themeRef.value === 'light' ? lightTheme : darkTheme,
}))
export const { message } = createDiscreteApi(['message'], { configProviderProps: configProviderPropsRef })

// 在组件上下文外检测系统主题，避免 naive-ui 的 useOsTheme 依赖 provider 环境
function osThemePreference(): 'light' | 'dark' {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  catch {
    return 'light'
  }
}

export function apiRespErrMsg(res: Response): boolean {
  const appStore = useAppStore()
  themeRef.value = appStore.theme === 'auto' ? osThemePreference() : appStore.theme === 'dark' ? 'dark' : 'light'

  const apiErrorCodeName = `apiErrorCode.${res.code}`
  const getI18nValue = t(apiErrorCodeName)
  if (apiErrorCodeName === getI18nValue) {
    return false
  }
  else {
    message.error(t(`apiErrorCode.${res.code}`))
    return true
  }
}
