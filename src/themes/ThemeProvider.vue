<script setup lang="ts">
import type { ThemeSurface } from './types'
import { computed, onUnmounted, provide, watchEffect } from 'vue'
import {
  buildProviderResult,
  commitLoadResult,
  getPreferredDark,
  getThemePreview,
  THEME_CONTEXT_KEY,
  watchSystemMode,
} from './runtime'
import { themeRegistry } from './registry'
import { createThemeContextValue } from './context'
import { packageRevision } from '@/packages/manager'

/**
 * 主题根容器：CSS 变量只应用到该容器内部，避免污染宿主页面。
 * - 批量原子更新：一次 style 赋值应用全部变量，避免逐变量闪烁；
 * - auto 模式由系统明暗 ref 驱动：变化时用新模式重新 resolve 完整 Token；
 * - 预览通道（setThemePreview）覆盖 Token/图标/Variant/主题 ID 的完整解析结果，
 *   提供给子孙组件的上下文同样来自预览结果；全局运行时状态在预览期间不提交；
 * - 解析或应用异常时回退默认主题，禁止白屏。
 */
const props = defineProps<{
  surface: ThemeSurface
  /** 原始主题选择（通常来自 panelConfig.theme）。 */
  selection?: unknown
}>()

// 显式依赖系统明暗 ref：系统切换 → getPreferredDark 变化 → 视图重算。
const view = computed(() => {
  void packageRevision.value
  void getPreferredDark()
  return buildProviderResult(getThemePreview() ?? props.selection ?? null, props.surface, themeRegistry)
})

watchEffect(() => {
  // 同步运行时全局状态（供非组件代码读取）；预览态不提交。
  // resolvedMode 与 view.loadResult 同源，保证模式与实际 Token 一致。
  if (!getThemePreview())
    commitLoadResult(view.value.loadResult, props.surface, view.value.resolvedMode)
})

// 稳定的响应式上下文：内部 getter 始终读取最新 view（深色切换/预览都实时生效）。
const providedContext = createThemeContextValue(() => ({
  surface: props.surface,
  themeId: view.value.loadResult.resolved.id,
  resolvedMode: view.value.resolvedMode,
  quarantined: view.value.loadResult.quarantined,
  tokens: view.value.loadResult.resolved.tokens,
  icons: view.value.loadResult.resolved.icons,
  variants: view.value.loadResult.resolved.variants,
  selection: view.value.loadResult.selection,
}))

provide(THEME_CONTEXT_KEY, providedContext)

// auto 模式跟随系统并响应变化（更新系统明暗 ref）。
const stopWatchingSystemMode = watchSystemMode()
onUnmounted(() => stopWatchingSystemMode())
</script>

<template>
  <div
    :class="view.rootClass"
    class="pn-theme-root"
    :data-surface="surface"
    :style="view.cssVariables"
    :data-bookmark="view.variants.bookmark"
    :data-widget="view.variants.widget"
    :data-sidebar="view.variants.sidebar"
    :data-search="view.variants.search"
  >
    <slot />
  </div>
</template>

<style src="./variantVars.css"></style>

<style scoped>
/*
 * 高度契约：原 RouterView 直接挂在 #app(height:100%) 下，
 * 首页内部 absolute h-full 滚动容器依赖这条百分比高度链。
 * 根容器必须保持 height:100%（不能用 min-height），否则链路断裂、内容区塌陷。
 */
.pn-theme-root {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
