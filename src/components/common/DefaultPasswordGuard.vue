<script setup lang="ts">
import { ref, watch } from 'vue'
import { NButton, NInput, NModal, useMessage } from 'naive-ui'
import { updatePassword } from '@/api/system/user'
import { logout } from '@/api'
import { t } from '@/locales'
import { useAuthStore } from '@/store'
import { router } from '@/router'
import { getRuntime } from '@/runtime'
import { openExtensionLogin } from '@/runtime/extensionLogin'
import { passwordChangeRequired } from '@/runtime/passwordChange'

const DEFAULT_PASSWORD = 'admin123'
const authStore = useAuthStore()
const ms = useMessage()
const form = ref({ current: '', password: '', confirm: '' })
const loading = ref(false)

// A signed-out account has nothing to change.
watch(() => authStore.token, (token) => {
  if (!token)
    passwordChangeRequired.value = false
})

function backToLogin() {
  passwordChangeRequired.value = false
  form.value = { current: '', password: '', confirm: '' }
  authStore.removeToken()
  if (getRuntime().kind === 'extension')
    openExtensionLogin()
  else
    router.push({ path: '/login' })
}

async function submit() {
  const { current, password, confirm } = form.value
  if (password.length < 6 || password.length > 50) {
    ms.error(t('adminSettingUsers.formRules.passwordLimit'))
    return
  }
  if (password !== confirm) {
    ms.error(t('defaultPassword.mismatch'))
    return
  }
  if (password === DEFAULT_PASSWORD) {
    ms.error(t('defaultPassword.same'))
    return
  }
  loading.value = true
  try {
    const { code } = await updatePassword(current, password)
    if (code === 0) {
      // The server revokes every session after a password change.
      ms.success(t('defaultPassword.done'))
      backToLogin()
    }
  }
  catch {
    ms.error(t('common.serverError'))
  }
  finally {
    loading.value = false
  }
}

async function signOut() {
  try {
    await logout()
  }
  catch { /* Signing out locally is enough. */ }
  backToLogin()
}
</script>

<template>
  <NModal
    :show="passwordChangeRequired"
    to=".pn-theme-root"
    preset="card"
    :title="t('defaultPassword.title')"
    :closable="false"
    :mask-closable="false"
    :close-on-esc="false"
    style="width: min(420px, calc(100vw - 32px))"
  >
    <form class="flex flex-col gap-3" @submit.prevent="submit">
      <p class="text-sm opacity-80">
        {{ t('defaultPassword.hint') }}
      </p>
      <NInput v-model:value="form.current" type="password" show-password-on="click" :placeholder="t('defaultPassword.current')" :input-props="{ autocomplete: 'current-password' }" />
      <NInput v-model:value="form.password" type="password" show-password-on="click" :placeholder="t('defaultPassword.new')" :input-props="{ autocomplete: 'new-password' }" />
      <NInput v-model:value="form.confirm" type="password" show-password-on="click" :placeholder="t('defaultPassword.confirm')" :input-props="{ autocomplete: 'new-password' }" />
      <div class="flex justify-end gap-2">
        <NButton :disabled="loading" @click="signOut">
          {{ t('defaultPassword.logout') }}
        </NButton>
        <NButton type="primary" attr-type="submit" :loading="loading">
          {{ t('defaultPassword.submit') }}
        </NButton>
      </div>
    </form>
  </NModal>
</template>
