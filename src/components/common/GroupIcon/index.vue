<script setup lang="ts">
import { computed } from 'vue'
import ItemIcon from '@/components/common/ItemIcon/index.vue'
import SvgIcon from '@/components/common/SvgIcon/index.vue'
import { decodeGroupAppearance, GROUP_ICON_PRESETS } from '@/icons/groupAppearance'

const props = withDefaults(defineProps<{ icon?: string; title?: string; size?: number }>(), { size: 28 })
const appearance = computed(() => decodeGroupAppearance(props.icon))
const local = computed(() => GROUP_ICON_PRESETS.some(item => item.icon === appearance.value.value))
</script>

<template>
  <span class="group-appearance-icon" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * .5)}px` }" aria-hidden="true">
    <span v-if="appearance.mode === 'text'" class="group-appearance-text">{{ appearance.value }}</span>
    <ItemIcon v-else-if="appearance.mode === 'image'" :item-icon="{ itemType: 2, src: appearance.value }" :fallback-text="title" :size="size" />
    <SvgIcon v-else-if="local" :icon="appearance.value" class="group-appearance-glyph" />
    <ItemIcon v-else :item-icon="{ itemType: 3, text: appearance.value }" :size="size" :fallback-text="title" />
  </span>
</template>

<style scoped>
.group-appearance-icon { display: inline-grid; place-items: center; flex: none; min-width: 0; overflow: hidden; border-radius: 8px; }
.group-appearance-text { color: inherit; font-weight: 650; white-space: nowrap; line-height: 1; }
.group-appearance-glyph { width: 75%; height: 75%; color: inherit; }
</style>
