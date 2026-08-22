<script setup lang="ts">
import type { FormInst, FormRules } from 'naive-ui'
import { NButton, NForm, NFormItem, NInput, NSelect, useDialog, useMessage } from 'naive-ui'
import { computed, ref } from 'vue'
import { useAppStore, useAuthStore, usePanelState, useUserStore } from '@/store'
import { languageOptions } from '@/utils/defaultData'
import type { Language, Theme } from '@/store/modules/app/helper'
import { logout } from '@/api'
import { RoundCardModal, SvgIcon } from '@/components/common/'
import { updateInfo, updatePassword } from '@/api/system/user'
import { updateLocalUserInfo } from '@/utils/cmn'
import { t } from '@/locales'

const userStore = useUserStore()
const authStore = useAuthStore()
const appStore = useAppStore()
const panelState = usePanelState()
const ms = useMessage()
const dialog = useDialog()

const languageValue = ref<Language>(appStore.language)
const themeValue = ref<Theme>(appStore.theme)
const nickName = ref(authStore.userInfo?.name || '')
const isEditNickNameStatus = ref(false)
const formRef = ref<FormInst | null>(null)

const isAdmin = computed(() => authStore.userInfo?.role === 1)
const displayName = computed(() => authStore.userInfo?.name || authStore.userInfo?.username || '-')
const avatarInitial = computed(() => displayName.value.trim().charAt(0).toUpperCase())

const themeSegments: { key: Theme; icon: string }[] = [
  { key: 'light', icon: 'material-symbols-light-mode-outline-rounded' },
  { key: 'dark', icon: 'material-symbols-dark-mode-outline-rounded' },
  { key: 'auto', icon: 'material-symbols-routine-outline-rounded' },
]

const updatePasswordModalState = ref({
  show: false,
  loading: false,
  form: {
    password: '',
    oldPassword: '',
    confirmPassword: '',
  },
})

const updatePasswordModalFormRules: FormRules = {
  oldPassword: {
    required: true,
    trigger: 'blur',
    min: 6,
    max: 20,
    message: t('adminSettingUsers.formRules.passwordLimit'),
  },
  password: {
    required: true,
    trigger: 'blur',
    min: 6,
    max: 20,
    message: t('adminSettingUsers.formRules.passwordLimit'),
  },
  confirmPassword: {
    required: true,
    trigger: 'blur',
    min: 6,
    max: 20,
    message: t('adminSettingUsers.formRules.passwordLimit'),
  },
}

async function logoutApi() {
  await logout()
  userStore.resetUserInfo()
  authStore.removeToken()
  panelState.removeState()
  appStore.removeToken()
  ms.success(t('settingUserInfo.logoutSuccess'))
  location.reload()// 强制刷新一下页面
}

function handleSaveInfo() {
  updateInfo(nickName.value).then(({ code, msg }) => {
    if (code === 0) {
      updateLocalUserInfo()
      isEditNickNameStatus.value = false
      ms.success(t('common.editSuccess'))
    }
    else {
      ms.error(`${t('common.editFail')}:${msg}`)
    }
  })
}

function handleUpdatePassword(e: MouseEvent) {
  e.preventDefault()
  formRef.value?.validate((errors) => {
    if (errors) {
      console.log(errors)
      return
    }

    if (updatePasswordModalState.value.form.password !== updatePasswordModalState.value.form.confirmPassword) {
      ms.error(t('settingUserInfo.confirmPasswordInconsistentMsg'))
      return
    }
    updatePasswordModalState.value.loading = true
    updatePassword(updatePasswordModalState.value.form.oldPassword, updatePasswordModalState.value.form.password).then(({ code }) => {
      if (code === 0) {
        // 成功
        updatePasswordModalState.value.show = false
        updatePasswordModalState.value.form.oldPassword = ''
        updatePasswordModalState.value.form.password = ''
        updatePasswordModalState.value.form.confirmPassword = ''
        ms.success(t('common.success'))
      }
    }).finally(() => {
      updatePasswordModalState.value.loading = false
    }).catch(() => {
      ms.error(t('common.serverError'))
    })
  })
}

function handleLogout() {
  dialog.warning({
    title: t('common.warning'),
    content: t('settingUserInfo.confirmLogoutText'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      logoutApi()
    },
  })
}

function handleChangeLanuage(value: Language) {
  if (value === appStore.language)
    return
  languageValue.value = value
  appStore.setLanguage(value)
  location.reload()
}

function handleChangeTheme(value: Theme) {
  themeValue.value = value
  appStore.setTheme(value)
}
</script>

<template>
  <div class="user-info-page h-full overflow-y-auto p-3 bg-gradient-to-b from-indigo-50/80 via-slate-50 to-slate-100 dark:from-zinc-900 dark:via-zinc-950 dark:to-black">
    <!-- 个人身份卡片 -->
    <div class="profile-hero relative overflow-hidden rounded-2xl border border-white/40 dark:border-white/10 shadow-lg shadow-indigo-200/40 dark:shadow-black/40">
      <div class="absolute inset-0 bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500" />
      <div class="absolute -top-10 -right-8 w-44 h-44 rounded-full bg-white/20 blur-3xl" />
      <div class="absolute -bottom-14 -left-6 w-40 h-40 rounded-full bg-sky-300/30 blur-3xl" />

      <div class="relative flex items-center gap-4 p-5">
        <div class="w-16 h-16 rounded-2xl bg-white/20 border border-white/40 backdrop-blur-xl flex items-center justify-center shrink-0 shadow-inner overflow-hidden">
          <img
            v-if="authStore.userInfo?.headImage"
            :src="authStore.userInfo.headImage"
            :alt="displayName"
            class="w-full h-full object-cover"
          >
          <span v-else class="text-2xl font-black text-white">{{ avatarInitial }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-lg font-bold text-white truncate">{{ displayName }}</span>
            <span
              class="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide"
              :class="isAdmin ? 'bg-amber-400/90 text-amber-950' : 'bg-white/25 text-white'"
            >
              {{ isAdmin ? t('apps.userInfo.roleAdmin') : t('apps.userInfo.roleUser') }}
            </span>
          </div>
          <div class="mt-0.5 text-xs text-white/75 truncate">
            @{{ authStore.userInfo?.username || '-' }}
          </div>
        </div>
      </div>
    </div>

    <!-- 个人资料 -->
    <section class="mt-3 rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.03]">
      <header class="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <SvgIcon icon="material-symbols-person-edit-outline-rounded" class="text-indigo-500 dark:text-indigo-400" />
        <h3 class="text-sm font-bold text-slate-700 dark:text-zinc-100">
          {{ t('apps.userInfo.profile') }}
        </h3>
      </header>
      <div class="px-4 pb-4 space-y-3">
        <div class="flex items-center justify-between gap-3 py-1.5">
          <span class="text-xs text-slate-400 dark:text-zinc-500">{{ $t('common.username') }}</span>
          <span class="text-sm font-medium text-slate-700 dark:text-zinc-200 truncate">{{ authStore.userInfo?.username || '-' }}</span>
        </div>
        <div class="border-t border-dashed border-slate-200 dark:border-white/[0.06]" />
        <div class="flex items-center justify-between gap-3 py-1.5">
          <span class="shrink-0 text-xs text-slate-400 dark:text-zinc-500">{{ $t('common.nikeName') }}</span>
          <template v-if="!isEditNickNameStatus">
            <div class="flex items-center gap-1 min-w-0">
              <span class="text-sm font-medium text-slate-700 dark:text-zinc-200 truncate">{{ authStore.userInfo?.name || '-' }}</span>
              <NButton size="tiny" quaternary type="primary" @click="isEditNickNameStatus = !isEditNickNameStatus">
                <template #icon>
                  <SvgIcon icon="mdi-pencil" />
                </template>
              </NButton>
            </div>
          </template>
          <div v-else class="flex items-center gap-1.5">
            <NInput
              v-model:value="nickName"
              size="small"
              class="!w-[150px]"
              type="text"
              :placeholder="$t('common.inputPlaceholder')"
              @keyup.enter="handleSaveInfo"
            />
            <NButton size="tiny" type="primary" secondary @click="handleSaveInfo">
              <template #icon>
                <SvgIcon icon="material-symbols-save" />
              </template>
            </NButton>
          </div>
        </div>
      </div>
    </section>

    <!-- 偏好设置 -->
    <section class="mt-3 rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.03]">
      <header class="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <SvgIcon icon="ion-color-palette-outline" class="text-indigo-500 dark:text-indigo-400" />
        <h3 class="text-sm font-bold text-slate-700 dark:text-zinc-100">
          {{ t('apps.userInfo.preferences') }}
        </h3>
      </header>
      <div class="px-4 pb-4 space-y-3">
        <div class="flex items-center justify-between gap-3 py-1.5">
          <span class="shrink-0 text-xs text-slate-400 dark:text-zinc-500">{{ $t('apps.userInfo.theme') }}</span>
          <div class="flex items-center gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-white/[0.06]">
            <button
              v-for="segment in themeSegments"
              :key="segment.key"
              type="button"
              class="flex items-center justify-center w-9 h-7 rounded-lg transition-all duration-200"
              :class="themeValue === segment.key
                ? 'bg-white dark:bg-indigo-500/90 text-indigo-600 dark:text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300'"
              :title="t(`apps.userInfo.themeStyle.${segment.key}`)"
              @click="handleChangeTheme(segment.key)"
            >
              <SvgIcon :icon="segment.icon" />
            </button>
          </div>
        </div>
        <div class="border-t border-dashed border-slate-200 dark:border-white/[0.06]" />
        <div class="flex items-center justify-between gap-3 py-1.5">
          <span class="shrink-0 text-xs text-slate-400 dark:text-zinc-500">{{ $t('common.language') }}</span>
          <div class="w-[140px]">
            <NSelect
              v-model:value="languageValue"
              size="small"
              :options="languageOptions"
              @update-value="handleChangeLanuage"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- 安全 -->
    <section class="mt-3 rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.03]">
      <header class="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <SvgIcon icon="mdi-shield-key-outline" class="text-indigo-500 dark:text-indigo-400" />
        <h3 class="text-sm font-bold text-slate-700 dark:text-zinc-100">
          {{ t('apps.userInfo.security') }}
        </h3>
      </header>
      <div class="px-4 pb-4">
        <button
          type="button"
          class="group flex items-center justify-between w-full py-2.5 text-left"
          @click="updatePasswordModalState.show = true"
        >
          <span class="flex items-center gap-2 text-sm text-slate-600 group-hover:text-indigo-600 dark:text-zinc-300 dark:group-hover:text-indigo-300 transition-colors">
            <SvgIcon icon="mdi-password-outline" />
            {{ $t('settingUserInfo.updatePassword') }}
          </span>
          <SvgIcon icon="mdi-chevron-right" class="text-slate-300 group-hover:text-indigo-500 dark:text-zinc-600 transition-colors" />
        </button>
      </div>
    </section>

    <!-- 退出登录 -->
    <NButton
      block
      size="medium"
      type="error"
      ghost
      class="mt-3 !rounded-2xl !font-semibold"
      @click="handleLogout"
    >
      <template #icon>
        <SvgIcon icon="tabler-logout" />
      </template>
      {{ $t('settingUserInfo.logout') }}
    </NButton>

    <RoundCardModal v-model:show="updatePasswordModalState.show" size="small" preset="card" style="width: min(400px, calc(100vw - 24px))" :title="$t('settingUserInfo.updatePassword')">
      <NForm ref="formRef" :model="updatePasswordModalState.form" :rules="updatePasswordModalFormRules">
        <NFormItem path="oldPassword" :label="$t('settingUserInfo.oldPassword')">
          <NInput v-model:value="updatePasswordModalState.form.oldPassword" show-password-on="click" :maxlength="20" type="password" :placeholder="$t('settingUserInfo.oldPassword')" />
        </NFormItem>

        <NFormItem path="password" :label="$t('settingUserInfo.newPassword')">
          <NInput v-model:value="updatePasswordModalState.form.password" show-password-on="click" :maxlength="20" type="password" :placeholder="$t('settingUserInfo.newPassword')" />
        </NFormItem>

        <NFormItem path="confirmPassword" :label="$t('settingUserInfo.confirmPassword')">
          <NInput v-model:value="updatePasswordModalState.form.confirmPassword" show-password-on="click" :maxlength="20" type="password" :placeholder="$t('settingUserInfo.confirmPassword')" />
        </NFormItem>
      </NForm>

      <template #footer>
        <div class="float-right">
          <NButton type="success" size="small" :loading="updatePasswordModalState.loading" @click="handleUpdatePassword">
            {{ $t('common.save') }}
          </NButton>
        </div>
      </template>
    </RoundCardModal>
  </div>
</template>
