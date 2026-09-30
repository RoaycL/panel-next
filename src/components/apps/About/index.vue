<script setup lang="ts">
import { NTag } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { get } from '@/api/system/about'
import srcSvglogo from '@/assets/logo.svg'

interface Version {
  versionName: string
  versionCode: number
}

const versionName = ref('')
const frontVersion = import.meta.env.VITE_APP_VERSION || 'unknown'

onMounted(() => {
  get<Version>().then((res) => {
    if (res.code === 0)
      versionName.value = res.data.versionName
  }).catch(() => {
    // Keep the bundled version visible when the server is unavailable.
    versionName.value = ''
  })
})
</script>

<template>
  <div class="pn-app-page about-page">
    <section class="pn-app-panel about-hero">
      <img :src="srcSvglogo" width="86" height="86" alt="">
      <h2 class="about-title">
        {{ $t('common.appName') }}
      </h2>
      <a class="pn-app-link about-version" href="https://github.com/RoaycL/panel-next/releases" :title="$t('apps.about.viewUpdateLog')" target="_blank" rel="noopener noreferrer">v{{ versionName || frontVersion }}</a>
      <p class="pn-app-muted about-description">
        {{ $t('apps.about.description') }}
      </p>
      <a class="pn-app-link" href="https://github.com/RoaycL/panel-next/releases" target="_blank" rel="noopener noreferrer">{{ $t('apps.about.checkUpdate') }}</a>
    </section>

    <section class="pn-app-panel about-links">
      <h3 class="pn-app-heading">
        {{ $t('common.appName') }}
      </h3>
      <p>{{ $t('apps.about.issue') }} <a class="pn-app-link" href="https://github.com/RoaycL/panel-next/issues" target="_blank" rel="noopener noreferrer">Github Issues</a></p>
      <p>{{ $t('apps.about.discussions') }} <a class="pn-app-link" href="https://github.com/RoaycL/panel-next/discussions" target="_blank" rel="noopener noreferrer">Github Discussions</a></p>
      <div class="about-project-link">
        <a class="pn-app-link" href="https://github.com/RoaycL/panel-next" target="_blank" rel="noopener noreferrer">Github</a>
      </div>
      <NTag :bordered="false" size="small">
        {{ $t('apps.about.frontVersionText') }}: FV-{{ frontVersion }}
      </NTag>
    </section>
  </div>
</template>

<style scoped>
.about-page { display: grid; width: min(100%, 620px); gap: 12px; margin: 0 auto; padding: 12px 0; }
.about-hero, .about-links { padding: clamp(20px, 5vw, 30px); }
.about-hero { display: flex; flex-direction: column; align-items: center; gap: 9px; text-align: center; }
.about-title { margin: 0; color: var(--pn-color-text-primary, #0f172a); font-size: 26px; font-weight: var(--pn-font-weight-heading, 700); }
.about-version { font-size: 16px; font-weight: 700; }
.about-description { max-width: 48ch; margin: 6px 0; line-height: 1.7; }
.about-links p { margin: 10px 0; line-height: 1.6; }
.about-project-link { display: flex; align-items: center; gap: 8px; margin: 12px 0 18px; }
</style>
