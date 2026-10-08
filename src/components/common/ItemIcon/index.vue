<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import SvgIconOnline from '@/components/common/SvgIconOnline/index.vue'
import { getCachedIconImage, getLocalIconImage } from '@/icons/localImageCache'
import { findIconPresetForUrl, resolveBundledPresetId } from '@/icons/presets'
import { getBundledBrandIcon } from '@/icons/brandAssets'
import { getRuntime } from '@/runtime'
import { isIconifyName } from '@/themes/icons'
import { readIconImageAppearance } from '@/icons/imageAppearance'
import type { IconImageAppearance } from '@/icons/imageAppearance'
import { normalizeIconScale } from '@/icons/iconScale'

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
const brandIcon = computed(() => getBundledBrandIcon(resolveBundledPresetId(props.itemIcon, props.siteUrl)))
const localSprite = computed(() => {
  const source = iconType.value === 2 ? props.itemIcon?.src : iconType.value === 3 ? props.itemIcon?.text : ''
  if (!source || !isIconifyName(source))
    return ''
  const name = source.replace(':', '-')
  return localSpriteNames.has(name) ? name : ''
})
const fallbackSprite = computed(() => iconType.value === 1 ? '' : localSprite.value || preset.value?.sprite || '')
const fallbackBrand = computed(() => iconType.value === 1 || localSprite.value ? '' : getBundledBrandIcon(preset.value?.id || ''))
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
const onlineIcon = computed(() => iconType.value === 3 && !brandIcon.value && !localSprite.value ? props.itemIcon?.text?.trim() || '' : '')
const imageFailed = ref(false)
const imageLoaded = ref(false)
const displayImageSrc = ref('')
const brandAppearance = ref<IconImageAppearance>({ transparent: false, darkMonochrome: false })
const imageAppearance = ref<IconImageAppearance>({ transparent: false, darkMonochrome: false })
watch([brandIcon, fallbackBrand], () => {
  brandAppearance.value = { transparent: false, darkMonochrome: false }
})
const visibleAppearance = computed(() => imageLoaded.value && !imageFailed.value ? imageAppearance.value : brandAppearance.value)
const hasImage = computed(() => Boolean((displayImageSrc.value && !imageFailed.value) || brandIcon.value || fallbackBrand.value))
function inspectImage(event: Event, brand = false) {
  const appearance = readIconImageAppearance(event.target as HTMLImageElement)
  if (brand) {
    brandAppearance.value = appearance
  }
  else {
    imageAppearance.value = appearance
    imageLoaded.value = true
  }
}
watch(imageSrc, (source, _previous, onCleanup) => {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    cancelled = true
    if (timer)
      clearTimeout(timer)
  })
  imageFailed.value = false
  imageLoaded.value = false
  imageAppearance.value = { transparent: false, darkMonochrome: false }
  displayImageSrc.value = ''
  if (!source)
    return
  if (!/^https?:\/\//i.test(source)) {
    displayImageSrc.value = source
    return
  }
  const load = () => {
    void getCachedIconImage(source).then((cached) => {
      if (cancelled) return
      if (cached) {
        displayImageSrc.value = cached.url
        return
      }
      // Cache misses paint natively immediately; downloads never block tiles.
      displayImageSrc.value = navigator.onLine ? source : ''
      void getLocalIconImage(source).then((local) => {
        if (!cancelled && local) displayImageSrc.value = local.url
      })
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
  if (savedColor && savedColor !== '#2a2a2a6b')
    return savedColor
  if (imageSrc.value && !imageFailed.value)
    return 'transparent'
  if (brandIcon.value || (fallbackBrand.value && (!displayImageSrc.value || imageFailed.value)))
    return '#ffffff'
  if (preset.value)
    return preset.value.color
  return generatedColor.value
})
// Icons render as their source image unless the item opts into the frosted tile.
const glassSurface = computed(() => props.itemIcon?.surface === 'glass' && !props.forceBackground)
const transparentBackground = computed(() => ['transparent', '#00000000'].includes(backgroundColor.value.toLowerCase()))
const foregroundColor = computed(() => {
  const color = backgroundColor.value.toLowerCase()
  return color === '#fff' || color === '#ffffff' ? '#4285f4' : '#fff'
})
const markFontSize = computed(() => `${Math.round(props.size * (Array.from(fallbackMark.value).length > 2 ? 0.25 : 0.31))}px`)
const iconScale = computed(() => normalizeIconScale(props.itemIcon?.scale))
</script>

<template>
  <div class="item-icon" :style="{ width: `${size}px`, height: `${size}px` }">
    <slot>
      <div
        class="item-icon-surface"
        :class="{
          'item-icon-surface-transparent': transparentBackground || (hasImage && visibleAppearance.transparent),
          'item-icon-surface-image': hasImage,
          'item-icon-surface-glass': glassSurface,
          'item-icon-image-transparent': hasImage && visibleAppearance.transparent,
          'item-icon-image-dark-mark': hasImage && visibleAppearance.transparent && visibleAppearance.darkMonochrome,
        }"
        :style="{ backgroundColor, color: foregroundColor, '--item-icon-scale': iconScale }"
      >
        <template v-if="!imageLoaded || imageFailed">
          <img v-if="brandIcon || fallbackBrand" :src="brandIcon || fallbackBrand" alt="" class="item-icon-brand" @load="inspectImage($event, true)">
          <SvgIcon v-else-if="fallbackSprite" :icon="fallbackSprite" class="item-icon-glyph" />
          <span v-else class="item-icon-mark" :style="{ fontSize: markFontSize }">{{ fallbackMark }}</span>
        </template>
        <img v-if="displayImageSrc && !imageFailed" :src="displayImageSrc" alt="" class="item-icon-image" @load="inspectImage($event)" @error="imageFailed = true">
        <SvgIconOnline v-if="onlineIcon" :icon="onlineIcon" class="item-icon-remote" />
      </div>
    </slot>
  </div>
</template>

<style scoped>
.item-icon-surface { position: relative; display: grid; width: 100%; height: 100%; place-items: center; overflow: hidden; border-radius: var(--pn-bookmark-icon-radius, 16px); }
.item-icon-glyph { width: 56%; height: 56%; flex: none; }
.item-icon-mark { max-width: 94%; overflow: hidden; font-weight: 800; line-height: 1; letter-spacing: -.05em; text-overflow: clip; white-space: nowrap; }
.item-icon-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.item-icon-surface-transparent .item-icon-image { object-fit: contain; }
.item-icon-brand { width: 78%; height: 78%; object-fit: contain; border-radius: calc(var(--pn-bookmark-icon-radius, 16px) * .78); }
.item-icon-remote { position: absolute; inset: 20%; width: 60%; height: 60%; }
.item-icon-surface > .item-icon-image,
.item-icon-surface > .item-icon-brand,
.item-icon-surface > .item-icon-glyph,
.item-icon-surface > .item-icon-mark,
.item-icon-surface > .item-icon-remote { transform: scale(var(--item-icon-scale, 1)); transform-origin: center; }
.item-icon-surface-glass {
  background: linear-gradient(145deg, rgba(255, 255, 255, .18), transparent 65%), rgba(255, 255, 255, .32) !important;
  -webkit-backdrop-filter: var(--pn-glass-control-filter, blur(18px) saturate(115%));
  backdrop-filter: var(--pn-glass-control-filter, blur(18px) saturate(115%));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .38), inset 0 1px 0 rgba(255, 255, 255, .28), 0 3px 10px rgba(0, 0, 0, .08);
}
/* Text and glyph icons keep contrast on the light frosted tile. */
.item-icon-surface-glass:not(.item-icon-surface-image) { color: #1f2937 !important; }
html.dark .item-icon-surface-glass:not(.item-icon-surface-image) { color: #fff !important; }
html.dark .item-icon-surface-glass {
  background: linear-gradient(145deg, rgba(255, 255, 255, .07), transparent 65%), rgba(24, 24, 28, .38) !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .14), inset 0 1px 0 rgba(255, 255, 255, .1), 0 3px 10px rgba(0, 0, 0, .12);
}
@media (prefers-reduced-transparency: reduce) {
  .item-icon-surface-glass { background: #f5f5f5 !important; -webkit-backdrop-filter: none; backdrop-filter: none; }
  html.dark .item-icon-surface-glass { background: #262626 !important; }
}
html.dark .item-icon-surface-image:not(.item-icon-image-transparent)::after { position: absolute; inset: 0; z-index: 1; border-radius: inherit; background: rgba(0, 0, 0, .14); pointer-events: none; content: ''; }
html.dark .item-icon-image-transparent > img { filter: drop-shadow(0 0 1px rgba(255, 255, 255, .4)); }
/* Only black monochrome transparent marks need a white night variant. */
html.dark .item-icon-image-dark-mark > img { filter: brightness(0) invert(1); }
.item-icon-surface:has(> svg.item-icon-remote) > .item-icon-glyph,
.item-icon-surface:has(> svg.item-icon-remote) > .item-icon-mark,
.item-icon-surface:has(> svg.item-icon-remote) > .item-icon-brand { visibility: hidden; }
</style>
