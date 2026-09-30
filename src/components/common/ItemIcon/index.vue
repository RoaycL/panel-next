<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import SvgIconOnline from '@/components/common/SvgIconOnline/index.vue'
import { getLocalIconImage } from '@/icons/localImageCache'
import { findIconPresetForUrl } from '@/icons/presets'
import { getRuntime } from '@/runtime'
import { isIconifyName } from '@/themes/icons'

interface Prop {
  itemIcon?: Panel.ItemIcon | null
  size?: number
  forceBackground?: string
  fallbackText?: string
  siteUrl?: string
  cacheDelay?: number
}

const props = withDefaults(defineProps<Prop>(), { size: 70 })
const localSpriteNames = new Set(['mdi-github', 'ri-bilibili-fill', 'ri-youtube-fill', 'mdi-code-tags', 'mdi-robot', 'solar-cpu-bold', 'mdi-docker', 'mdi-web'])
const fallbackColors = ['#4275bd', '#7564b0', '#278b87', '#bd684d', '#526f9e', '#a56687']

const preset = computed(() => findIconPresetForUrl(props.siteUrl))
const iconType = computed(() => props.itemIcon?.itemType)
const localSprite = computed(() => {
  const source = iconType.value === 2 ? props.itemIcon?.src : iconType.value === 3 ? props.itemIcon?.text : ''
  if (!source || !isIconifyName(source))
    return ''
  const name = source.replace(':', '-')
  return localSpriteNames.has(name) ? name : ''
})
const fallbackSprite = computed(() => iconType.value === 1 ? '' : localSprite.value || preset.value?.sprite || '')
const imageSrc = computed(() => {
  const source = props.itemIcon?.src?.trim()
  if (iconType.value !== 2 || !source || isIconifyName(source))
    return ''
  try {
    const runtime = getRuntime()
    return new URL(runtime.resolveUrl(source), `${runtime.getServerOrigin() || window.location.origin}/`).href
  }
  catch {
    return ''
  }
})
const onlineIcon = computed(() => iconType.value === 3 && !localSprite.value ? props.itemIcon?.text?.trim() || '' : '')
const imageFailed = ref(false)
const displayImageSrc = ref('')
watch(imageSrc, (source, _previous, onCleanup) => {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    cancelled = true
    if (timer)
      clearTimeout(timer)
  })
  imageFailed.value = false
  displayImageSrc.value = ''
  if (!source)
    return
  if (!/^https?:\/\//i.test(source)) {
    displayImageSrc.value = source
    return
  }
  const load = () => {
    void getLocalIconImage(source).then((local) => {
      if (!cancelled)
        displayImageSrc.value = local?.url || (navigator.onLine ? source : '')
    })
  }
  if (props.cacheDelay)
    timer = setTimeout(load, props.cacheDelay)
  else
    load()
}, { immediate: true })

const fallbackMark = computed(() => {
  if (iconType.value === 1 && props.itemIcon?.text?.trim())
    return props.itemIcon.text.trim()
  if (preset.value)
    return preset.value.mark
  const label = (props.fallbackText || props.siteUrl || '?').trim()
  return Array.from(label).slice(0, 2).join('').toUpperCase()
})
const generatedColor = computed(() => {
  const value = props.siteUrl || props.fallbackText || '?'
  const hash = Array.from(value).reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return fallbackColors[hash % fallbackColors.length]
})
const backgroundColor = computed(() => {
  if (props.forceBackground)
    return props.forceBackground
  const savedColor = props.itemIcon?.backgroundColor
  if (preset.value && (iconType.value === 2 || onlineIcon.value || !savedColor || savedColor === '#2a2a2a6b'))
    return preset.value.color
  return savedColor && savedColor !== '#2a2a2a6b' ? savedColor : generatedColor.value
})
const foregroundColor = computed(() => {
  const color = backgroundColor.value.toLowerCase()
  return color === '#fff' || color === '#ffffff' ? '#4285f4' : '#fff'
})
const markFontSize = computed(() => `${Math.round(props.size * (Array.from(fallbackMark.value).length > 2 ? 0.25 : 0.31))}px`)
</script>

<template>
  <div class="item-icon" :style="{ width: `${size}px`, height: `${size}px` }">
    <slot>
      <div
        class="item-icon-surface"
        :style="{ width: `${size}px`, height: `${size}px`, backgroundColor, color: foregroundColor }"
      >
        <SvgIcon v-if="fallbackSprite" :icon="fallbackSprite" class="item-icon-glyph" />
        <span v-else class="item-icon-mark" :style="{ fontSize: markFontSize }">{{ fallbackMark }}</span>
        <img v-if="displayImageSrc && !imageFailed" :src="displayImageSrc" alt="" class="item-icon-image" @error="imageFailed = true">
        <SvgIconOnline v-if="onlineIcon" :icon="onlineIcon" class="item-icon-remote" />
      </div>
    </slot>
  </div>
</template>

<style scoped>
.item-icon-surface { position: relative; display: grid; place-items: center; overflow: hidden; border-radius: var(--pn-bookmark-icon-radius, 16px); }
.item-icon-glyph { width: 56%; height: 56%; flex: none; }
.item-icon-mark { max-width: 94%; overflow: hidden; font-weight: 800; line-height: 1; letter-spacing: -.05em; text-overflow: clip; white-space: nowrap; }
.item-icon-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.item-icon-remote { position: absolute; inset: 20%; width: 60%; height: 60%; }
.item-icon-surface:has(> svg.item-icon-remote) > .item-icon-glyph,
.item-icon-surface:has(> svg.item-icon-remote) > .item-icon-mark { visibility: hidden; }
</style>
