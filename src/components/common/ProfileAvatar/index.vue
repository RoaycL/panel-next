<script setup lang="ts">
import { computed, h } from 'vue'
import { NAvatar } from 'naive-ui'
import ThemeIcon from '@/themes/ThemeIcon.vue'

const props = withDefaults(defineProps<{
  src?: string
  size?: number
  round?: boolean
}>(), { src: '', size: 42, round: false })

const iconStyle = computed(() => ({ width: `${Math.round(props.size * 0.58)}px`, height: `${Math.round(props.size * 0.58)}px` }))
function renderUserIcon() {
  return h(ThemeIcon, { name: 'user', style: iconStyle.value, class: 'profile-avatar-symbol' })
}
</script>

<template>
  <!-- A default text slot overrides NAvatar's src, so only render it without an image. -->
  <NAvatar
    :key="src"
    class="profile-avatar-control"
    :src="src || undefined"
    :size="size"
    :round="round"
    object-fit="cover"
    :img-props="{ alt: '' }"
    :render-placeholder="renderUserIcon"
    :render-fallback="renderUserIcon"
  >
    <ThemeIcon v-if="!src" name="user" class="profile-avatar-symbol" :style="iconStyle" />
  </NAvatar>
</template>

<style scoped>
.profile-avatar-control { display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; }
.profile-avatar-control :deep(.profile-avatar-symbol) { display: block; flex: none; color: var(--pn-profile-avatar-color, var(--pn-color-text-primary, #0f172a)); }
</style>
