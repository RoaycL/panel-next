<script setup lang="ts">
import type { Component } from 'vue'
import { computed, shallowRef, useAttrs, watch } from 'vue'
import type { WidgetInstance } from './types'
import { widgetRegistry } from './registry'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ instance: WidgetInstance }>()
const attrs = useAttrs()
const component = shallowRef<Component | null>(null)
const componentProps = computed(() => ({
  ...(typeof props.instance.config === 'object' && props.instance.config !== null ? props.instance.config : {}),
  ...attrs,
}))
let loadGeneration = 0

watch(() => props.instance.type, async (type) => {
  const generation = ++loadGeneration
  component.value = null
  const definition = widgetRegistry.get(type)
  if (!definition)
    return
  try {
    const loaded = await definition.load()
    if (generation === loadGeneration)
      component.value = loaded
  }
  catch (error) {
    console.error(`Failed to load widget ${type}.`, error)
  }
}, { immediate: true })
</script>

<template>
  <component :is="component" v-if="component && !instance.hidden" v-bind="componentProps" />
</template>
