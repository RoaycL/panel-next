<script setup lang="ts">
import { NButton, NCard, NForm, NFormItem, NInput, NSelect, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { login } from '@/api'
import { getSiteInfo } from '@/api/site'
import { useAppStore, useAuthStore } from '@/store'
import { SvgIcon, Captcha } from '@/components/common'
import { router } from '@/router'
import { t } from '@/locales'
import { languageOptions } from '@/utils/defaultData'
import type { Language } from '@/store/modules/app/helper'
import { getRuntime } from '@/runtime'

const authStore = useAuthStore()
const appStore = useAppStore()
const runtime = getRuntime()
const isExtension = runtime.kind === 'extension'
const ms = useMessage()
const loading = ref(false)
const languageValue = ref<Language>(appStore.language)
const siteTitle = ref('')
const showCaptcha = ref(false)
const captchaRef = ref<InstanceType<typeof Captcha> | null>(null)
const captchaId = ref('')
const siteBranding = ref<{ loginBackground?: string } | null>(null)

const loginTitle = computed(() => siteTitle.value || t('common.appName'))
const loginBackgroundStyle = computed(() => {
  const background = siteBranding.value?.loginBackground
  return background
    ? {
        backgroundImage: `url(${background})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined
})

function applyFavicon(favicon: string) {
  if (!favicon)
    return
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = favicon
}

const form = ref<Login.LoginReqest>({
  username: '',
  password: '',
})

async function checkLoginConfig() {
  try {
    const { getLoginConfig } = await import('@/api')
    const res = await getLoginConfig<{ loginCaptcha: boolean }>()
    if (res.code === 0 && res.data?.loginCaptcha) {
      showCaptcha.value = true
      captchaId.value = `${Date.now()}`
      await captchaRef.value?.refresh()
    }
  }
  catch {
    // 静默失败
  }
}

async function loginPost() {
  if (loading.value)
    return
  loading.value = true
  try {
    const res = await login<Login.DeviceSessionLoginResponse>({
      ...form.value,
      username: form.value.username.trim(),
      vcode: form.value.vcode?.trim(),
    })
    if (res.code === 0) {
      const session = res.data as Login.DeviceSessionLoginResponse
      const user = session.user
      authStore.setDeviceSession(session)
      try {
        await runtime.storage.flush?.()
      }
      catch {
        ms.warning(t('login.sessionSaveWarning'))
      }
      ms.success(`Hi ${user.name}, ${t('login.welcomeMessage')}`)
      await router.push({ path: '/' })
    }
    else {
      ms.error(t(`apiErrorCode.${res.code}`, {}, res.msg))
      if (showCaptcha.value) {
        captchaId.value = `${Date.now()}`
        captchaRef.value?.refresh()
      }
    }
  }
  catch (error) {
    ms.error(t('common.networkError'))
    console.error(error)
  }
  finally {
    loading.value = false
  }
}

// const isShowCaptcha = ref<boolean>(false)
// const isShowRegister = ref<boolean>(false)

function handleSubmit() {
  if (loading.value)
    return
  if (!form.value.username.trim() || !form.value.password) {
    ms.warning(t('login.credentialsRequired'))
    return
  }
  if (showCaptcha.value && !form.value.vcode?.trim()) {
    ms.warning(t('login.captchaRequired'))
    return
  }
  void loginPost()
}

onMounted(async () => {
  try {
    const res = await getSiteInfo()
    if (res.code === 0 && res.data) {
      siteTitle.value = res.data.siteTitle
      siteBranding.value = { loginBackground: res.data.loginBackground }
      if (res.data.siteTitle)
        document.title = res.data.siteTitle
      applyFavicon(res.data.siteFavicon)
    }
  }
  catch (error) {
    console.warn('Failed to load site branding on the login page.', error)
  }
  await checkLoginConfig()
})

function handleChangeLanuage(value: Language) {
  languageValue.value = value
  appStore.setLanguage(value)
}
</script>

<template>
  <div class="login-container" :style="loginBackgroundStyle">
    <div class="login-backdrop" aria-hidden="true" />
    <NCard class="login-card" :bordered="false">
      <div class="login-toolbar">
        <div class="login-brand-mark">
          <img src="/logo.png" alt="">
          <span>Panel Next</span>
        </div>
        <div class="login-language">
          <SvgIcon icon="ion-language" aria-hidden="true" />
          <NSelect
            v-model:value="languageValue"
            size="small"
            :options="languageOptions"
            :aria-label="$t('common.language')"
            @update-value="handleChangeLanuage"
          />
        </div>
      </div>

      <header class="login-heading">
        <p class="login-eyebrow">
          {{ $t('login.eyebrow') }}
        </p>
        <h1>{{ loginTitle }}</h1>
        <p class="login-subtitle">
          {{ $t('login.subtitle') }}
        </p>
      </header>

      <NForm class="login-form" :model="form" label-placement="top" @submit.prevent="handleSubmit">
        <NFormItem :label="$t('common.username')">
          <NInput
            v-model:value="form.username"
            size="large"
            autocomplete="username"
            :placeholder="$t('login.usernamePlaceholder')"
          >
            <template #prefix>
              <SvgIcon icon="ph:user-bold" />
            </template>
          </NInput>
        </NFormItem>

        <NFormItem :label="$t('common.password')">
          <NInput
            v-model:value="form.password"
            size="large"
            type="password"
            show-password-on="click"
            autocomplete="current-password"
            :placeholder="$t('login.passwordPlaceholder')"
          >
            <template #prefix>
              <SvgIcon icon="mdi:password-outline" />
            </template>
          </NInput>
        </NFormItem>

        <NFormItem v-if="showCaptcha" :label="$t('login.captchaPlaceholder')">
          <div class="captcha-row">
            <button class="captcha-image" type="button" :title="$t('login.captchaPlaceholder')" @click="captchaRef?.refresh()">
              <Captcha ref="captchaRef" :src="`/api/captcha/getImage?captchaId=${captchaId}`" />
            </button>
            <NInput v-model:value="form.vcode" size="large" type="text" :placeholder="$t('login.captchaPlaceholder')" />
          </div>
        </NFormItem>
        <NFormItem class="login-submit-item">
          <NButton type="primary" attr-type="submit" size="large" block :loading="loading" :disabled="loading">
            {{ $t('login.loginButton') }}
          </NButton>
        </NFormItem>

        <!-- <div class="flex justify-end">
          <NButton v-if="isShowRegister" quaternary type="info" class="flex" @click="$router.push({ path: '/register' })">
            注册
          </NButton>
          <NButton quaternary type="info" class="flex" @click="$router.push({ path: '/resetPassword' })">
            忘记密码?
          </NButton>
        </div> -->

        <p class="login-security-note">
          <span class="login-security-dot" aria-hidden="true" />
          {{ $t('login.secureHint') }}
        </p>
        <button v-if="isExtension" type="button" class="login-guest-link" @click="router.push('/')">
          {{ $t('login.continueAsGuest') }}
        </button>
      </NForm>
    </NCard>
  </div>
</template>

<style scoped>
.login-container {
  position: relative;
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  place-items: center;
  overflow: hidden;
  padding: clamp(18px, 4vw, 48px);
  color: var(--pn-color-text-primary, #0f172a);
  background:
    radial-gradient(circle at 14% 8%, color-mix(in srgb, var(--pn-color-accent, #10b981) 22%, transparent), transparent 34%),
    radial-gradient(circle at 88% 92%, color-mix(in srgb, var(--pn-icon-active-color, #0284c7) 20%, transparent), transparent 38%),
    var(--pn-color-page-background, #eef8ff);
  background-position: center;
  background-size: cover;
  isolation: isolate;
}

.login-backdrop {
  position: absolute;
  z-index: -1;
  inset: 0;
  background: linear-gradient(135deg, var(--pn-color-mask, rgb(2 6 23 / 12%)), transparent 52%);
  pointer-events: none;
}

.login-card {
  width: min(440px, 100%);
  margin: 0;
  border: 1px solid var(--pn-modal-border, var(--pn-color-border, rgb(148 163 184 / 28%))) !important;
  border-radius: var(--pn-radius-large, 18px) !important;
  background: color-mix(in srgb, var(--pn-modal-background, #fff) 92%, transparent) !important;
  box-shadow: var(--pn-effect-shadow-high, 0 22px 60px rgb(2 6 23 / 24%));
  backdrop-filter: blur(calc(var(--pn-effect-blur, 14px) + 6px)) saturate(145%);
}

.login-toolbar,
.login-brand-mark,
.login-language,
.captcha-row,
.login-security-note {
  display: flex;
  align-items: center;
}

.login-toolbar {
  justify-content: space-between;
  gap: 16px;
}

.login-brand-mark {
  min-width: 0;
  gap: 9px;
  color: var(--pn-color-text-secondary, #334155);
  font-size: 13px;
  font-weight: var(--pn-font-weight-heading, 600);
  letter-spacing: -.01em;
}

.login-brand-mark img {
  width: 30px;
  height: 30px;
  border-radius: var(--pn-radius-small, 8px);
  box-shadow: var(--pn-effect-shadow-low, 0 1px 3px rgb(2 6 23 / 18%));
}

.login-language {
  width: 126px;
  gap: 7px;
  color: var(--pn-color-text-muted, #64748b);
}

.login-language > :first-child {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
}

.login-language :deep(.n-select) {
  min-width: 0;
}

.login-heading {
  margin: 38px 0 30px;
}

.login-eyebrow {
  margin: 0 0 8px;
  color: var(--pn-color-accent, #10b981);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.login-heading h1 {
  margin: 0;
  color: var(--pn-color-text-primary, #0f172a);
  font-size: clamp(28px, 7vw, 36px);
  font-weight: 700;
  letter-spacing: -.045em;
  line-height: 1.15;
}

.login-subtitle {
  margin: 12px 0 0;
  color: var(--pn-color-text-muted, #64748b);
  font-size: 14px;
  line-height: 1.65;
}

.login-form :deep(.n-form-item-label) {
  color: var(--pn-color-text-secondary, #334155);
  font-size: 13px;
  font-weight: 600;
}

.login-form :deep(.n-input) {
  min-height: 44px;
}

.captcha-row {
  width: 100%;
  gap: 12px;
}

.captcha-image {
  display: flex;
  width: 120px;
  height: 44px;
  flex: 0 0 auto;
  align-items: center;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--pn-color-border, rgb(148 163 184 / 28%));
  border-radius: var(--pn-radius-medium, 12px);
  background: var(--pn-color-surface, #fff);
  cursor: pointer;
}

.login-submit-item {
  margin-top: 8px;
}

.login-submit-item :deep(.n-button) {
  min-height: 46px;
  box-shadow: 0 10px 24px color-mix(in srgb, var(--pn-color-accent, #10b981) 24%, transparent);
}

.login-security-note {
  justify-content: center;
  gap: 7px;
  margin: 2px 0 0;
  color: var(--pn-color-text-muted, #64748b);
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}

.login-security-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--pn-color-success, #34d399);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pn-color-success, #34d399) 16%, transparent);
}

.login-guest-link {
  display: block;
  min-height: 40px;
  margin: 8px auto 0;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--pn-radius-medium, 12px);
  color: var(--pn-color-text-secondary, #334155);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.login-guest-link:hover { color: var(--pn-color-accent, #10b981); background: var(--pn-color-surface-hover, rgb(148 163 184 / 8%)); }

@media (max-width: 480px) {
  .login-container {
    align-items: start;
    overflow-y: auto;
    padding: 12px;
  }

  .login-card {
    margin: max(12px, env(safe-area-inset-top)) 0 max(12px, env(safe-area-inset-bottom));
  }

  .login-heading {
    margin: 30px 0 24px;
  }

  .login-brand-mark span {
    display: none;
  }
}
</style>
