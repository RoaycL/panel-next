<script setup lang="ts">
import { defineAsyncComponent, onMounted, shallowRef, watch } from 'vue'
import { NButton, NSpin } from 'naive-ui'

const props = defineProps<{
  componentName: string | null
}>()
const loading = shallowRef(false)
const dynamicComponent = shallowRef('')
const loadFailed = shallowRef(false)

function updateComponent() {
  loading.value = true
  loadFailed.value = false
  dynamicComponent.value = defineAsyncComponent(() =>
    import(`../../apps/${props.componentName}/index.vue`)
      .finally(() => {
        loading.value = false
      }).catch(() => {
      // 组件不存在
        loadFailed.value = true
        dynamicComponent.value = ''
        return null
      }),
  )
}

watch(() => props.componentName, () => {
  updateComponent()
})

onMounted(() => {
  updateComponent()
})
</script>

<template>
  <div class="h-full">
    <NSpin :show="loading" style="height: 100%;" content-style="height: 100%;" :delay="500" description="loading...">
      <component :is="dynamicComponent" v-if="dynamicComponent" />
      <!-- <component :is="getComponent(componentName || '')" v-if="dynamicComponent" /> -->
      <div v-else-if="loadFailed" class="pn-app-empty">
        <p>{{ $t('appLauncher.loadFailed') }}</p>
        <NButton secondary size="small" @click="updateComponent">
          {{ $t('common.retry') }}
        </NButton>
      </div>
    </NSpin>
  </div>
</template>
