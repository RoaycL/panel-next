<script setup lang="ts">
import { computed } from 'vue'
import { useWidgetContext } from '@/widgets/context'
import { getRuntime } from '@/runtime'
import { installedPackages } from './manager'
import type { PluginPackage } from './pluginPackage'

const context = useWidgetContext()
const plugin = computed(() => (installedPackages.value.find(item => item.kind === 'plugin' && item.id === context?.type)?.manifest as PluginPackage | undefined)?.plugin)
</script>

<template>
  <section v-if="plugin" class="remote-data-widget">
    <header>{{ plugin.name }}</header>
    <div class="remote-data-blocks">
      <div v-for="(block, index) in plugin.blocks" :key="index" class="remote-data-block">
        <button v-if="block.kind === 'link'" type="button" @click="getRuntime().openUrl(block.url!, 'tab')">
          {{ block.label }} <span aria-hidden="true">↗</span>
        </button>
        <template v-else>
          <small>{{ block.label }}</small>
          <strong v-if="block.kind === 'metric'">{{ block.value }}</strong>
          <p v-else>
            {{ block.value }}
          </p>
        </template>
      </div>
    </div>
    <footer v-if="plugin.author">
      {{ plugin.author }}
    </footer>
  </section>
</template>

<style scoped>
.remote-data-widget { display:flex; flex-direction:column; gap:var(--pn-spacing-normal); padding:var(--pn-spacing-normal); border-radius:var(--pn-radius-large); background:var(--pn-widget-background); border:1px solid var(--pn-widget-border); color:var(--pn-widget-text-color); box-shadow:var(--pn-widget-shadow); backdrop-filter:var(--pn-glass-filter); }
header { font-weight:var(--pn-font-weight-heading); font-size:12px; }
.remote-data-blocks { flex:1; min-height:0; overflow:auto; display:grid; gap:8px; align-content:center; }
.remote-data-block { overflow-wrap:anywhere; }
small, footer { color:var(--pn-widget-muted-text); font-size:10px; }
strong { display:block; font-size:clamp(18px,12cqw,36px); font-variant-numeric:tabular-nums; }
p { margin:2px 0; font-size:12px; }
button { width:100%; display:flex; justify-content:space-between; padding:6px 8px; border-radius:var(--pn-radius-small); background:var(--pn-color-surface-hover); text-align:left; font-size:12px; }
</style>
