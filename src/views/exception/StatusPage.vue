<script setup lang="ts">
import { NButton } from 'naive-ui'
import { useRouter } from 'vue-router'

defineProps<{
  code: string
  title: string
  description: string
  retry?: boolean
}>()

const router = useRouter()

function goHome() {
  void router.push('/')
}

function reload() {
  window.location.reload()
}
</script>

<template>
  <main class="status-page">
    <section class="status-card" :aria-labelledby="`status-title-${code}`">
      <div class="status-visual" aria-hidden="true">
        <div class="status-orbit">
          <span>{{ code }}</span>
        </div>
      </div>
      <p class="status-eyebrow">
        PANEL NEXT · {{ code }}
      </p>
      <h1 :id="`status-title-${code}`">
        {{ title }}
      </h1>
      <p class="status-description">
        {{ description }}
      </p>
      <div class="status-actions">
        <NButton type="primary" size="large" @click="goHome">
          {{ $t('statusPage.backHome') }}
        </NButton>
        <NButton v-if="retry" secondary size="large" @click="reload">
          {{ $t('statusPage.retry') }}
        </NButton>
      </div>
    </section>
  </main>
</template>

<style scoped>
.status-page {
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  place-items: center;
  padding: max(20px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom));
  color: var(--pn-color-text-primary, #0f172a);
  background:
    radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--pn-color-accent, #10b981) 16%, transparent), transparent 34%),
    radial-gradient(circle at 84% 86%, color-mix(in srgb, var(--pn-icon-active-color, #0284c7) 15%, transparent), transparent 35%),
    var(--pn-color-page-background, #f3f8fb);
}

.status-card {
  width: min(100%, 520px);
  padding: clamp(26px, 6vw, 48px);
  border: 1px solid var(--pn-color-border, rgb(148 163 184 / 24%));
  border-radius: var(--pn-radius-large, 18px);
  background: color-mix(in srgb, var(--pn-color-surface, #fff) 92%, transparent);
  box-shadow: var(--pn-effect-shadow-high, 0 22px 60px rgb(2 6 23 / 12%));
  text-align: center;
  backdrop-filter: blur(var(--pn-effect-blur, 14px));
}

.status-visual { display: grid; min-height: 150px; place-items: center; }
.status-orbit {
  display: grid;
  width: 142px;
  height: 142px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--pn-color-accent, #10b981) 35%, transparent);
  border-radius: 50%;
  color: var(--pn-color-accent, #10b981);
  background: radial-gradient(circle, color-mix(in srgb, var(--pn-color-accent, #10b981) 15%, transparent), transparent 70%);
  box-shadow: 0 0 0 13px color-mix(in srgb, var(--pn-color-accent, #10b981) 7%, transparent);
}
.status-orbit span { font-size: 52px; font-weight: 800; letter-spacing: -.08em; font-variant-numeric: tabular-nums; }
.status-eyebrow { margin: 24px 0 8px; color: var(--pn-color-accent, #10b981); font-size: 11px; font-weight: 800; letter-spacing: .12em; }
.status-card h1 { margin: 0; font-size: clamp(25px, 6vw, 34px); line-height: 1.2; }
.status-description { max-width: 38ch; margin: 14px auto 0; color: var(--pn-color-text-secondary, #475569); font-size: 14px; line-height: 1.7; }
.status-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
.status-actions :deep(.n-button) { min-width: 120px; min-height: 44px; }

@media (max-width: 400px) {
  .status-actions { display: grid; }
  .status-actions :deep(.n-button) { width: 100%; }
}
</style>
