<script setup lang="ts">
import type { ThemeIconName } from './types'
import { computed } from 'vue'
import { Icon as IconifyIcon } from '@iconify/vue'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import { useTheme } from './context'
import { DEFAULT_ICON_SET, resolveThemeIconResource } from './icons'
import type { ThemeIconResource } from './icons'

/**
 * 语义图标：只接受 ThemeIconName 语义名。
 * - 图标资源来自当前主题的图标包，缺失时回退默认包；
 * - 支持两类资源值：
 *   1) 本地 SVG 雪碧图名（小写字母数字与连字符，随应用打包，离线可用）；
 *   2) Iconify 名称（形如 mdi:pencil）；
 * - Extension 表面禁止 Iconify 在线加载（allowIconifyOnline:false），
 *   只使用随包资源，避免因主题图标产生外部网络请求；
 * - 危险 scheme（javascript:/data:/http: 等）一律拒绝并安全回退默认包；
 * - 单色图标使用 currentColor；用户上传图片/favicon 不经过本组件。
 */
const props = defineProps<{
  name: ThemeIconName
}>()

const theme = useTheme()

/** Extension 表面优先随包资源：不触发 Iconify 在线加载。 */
const allowIconifyOnline = theme.surface !== 'extension'

const resolved = computed<ThemeIconResource>(() => {
  return resolveThemeIconResource(theme.icons[props.name], { allowIconifyOnline })
    ?? resolveThemeIconResource(DEFAULT_ICON_SET[props.name], { allowIconifyOnline })
    ?? { kind: 'sprite', name: 'mdi-pencil' }
})
</script>

<template>
  <IconifyIcon v-if="resolved.kind === 'iconify'" :icon="resolved.name" aria-hidden="true" />
  <SvgIcon v-else :icon="resolved.name" />
</template>
