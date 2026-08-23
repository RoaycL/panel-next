<script setup lang="ts">
import type { FormInst, FormRules } from 'naive-ui'
import { NAvatar, NButton, NForm, NFormItem, NInput, NSelect, useDialog, useMessage } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import { useAppStore, useAuthStore, usePanelState, useUserStore } from '@/store'
import { languageOptions } from '@/utils/defaultData'
import type { Language, Theme } from '@/store/modules/app/helper'
import { logout } from '@/api'
import { RoundCardModal, SvgIcon } from '@/components/common/'
import { updateInfo, updatePassword } from '@/api/system/user'
import { updateLocalUserInfo } from '@/utils/cmn'
import { t } from '@/locales'
import { getRuntime } from '@/runtime'

const { embedded = false } = defineProps<{ embedded?: boolean }>()

const userStore = useUserStore()
const authStore = useAuthStore()
const appStore = useAppStore()
const panelState = usePanelState()
const ms = useMessage()
const dialog = useDialog()
const runtime = getRuntime()

const languageValue = ref<Language>(appStore.language)
const themeValue = ref<Theme>(appStore.theme)
const nickName = ref(authStore.userInfo?.name || authStore.userInfo?.username || '')
const profileMail = ref(authStore.userInfo?.mail || '')
const profileHeadImage = ref(authStore.userInfo?.headImage || '')
const isSavingProfile = ref(false)
const formRef = ref<FormInst | null>(null)

const isAdmin = computed(() => authStore.userInfo?.role === 1)
const displayName = computed(() => authStore.userInfo?.name || authStore.userInfo?.username || '-')
const avatarInitial = computed(() => displayName.value.trim().charAt(0).toUpperCase())
const profileAvatarUrl = computed(() => runtime.resolveUrl(authStore.userInfo?.headImage?.trim() || ''))
const draftAvatarUrl = computed(() => runtime.resolveUrl(profileHeadImage.value.trim()))
const isProfileDirty = computed(() => nickName.value.trim() !== (authStore.userInfo?.name || authStore.userInfo?.username || '').trim()
  || profileMail.value.trim() !== (authStore.userInfo?.mail || '').trim()
  || profileHeadImage.value.trim() !== (authStore.userInfo?.headImage || '').trim())
const avatarPresets = [
  'https://api.dicebear.com/7.x/bottts/svg?seed=Felix',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Luna',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Leo',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Mia',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Max',
]

function resetProfileDraft() {
  nickName.value = authStore.userInfo?.name || authStore.userInfo?.username || ''
  profileMail.value = authStore.userInfo?.mail || ''
  profileHeadImage.value = authStore.userInfo?.headImage || ''
}

function isValidEmail(value: string) {
  if (/\s/.test(value))
    return false
  const separator = value.indexOf('@')
  if (separator <= 0 || separator !== value.lastIndexOf('@'))
    return false
  const domain = value.slice(separator + 1)
  return domain.length >= 3 && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}

watch(() => authStore.userInfo, resetProfileDraft, { deep: true })

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

async function handleSaveInfo() {
  const name = nickName.value.trim()
  const mail = profileMail.value.trim()
  const headImage = profileHeadImage.value.trim()
  if (name.length < 3 || name.length > 15) {
    ms.warning('昵称长度需为 3～15 个字符')
    return
  }
  if (mail && !isValidEmail(mail)) {
    ms.warning('请输入有效的邮箱地址')
    return
  }

  isSavingProfile.value = true
  try {
    const { code, msg } = await updateInfo({ name, mail, headImage })
    if (code !== 0) {
      ms.error(`${t('common.editFail')}:${msg}`)
      return
    }
    if (authStore.userInfo)
      authStore.setUserInfo({ ...authStore.userInfo, name, mail, headImage })
    await updateLocalUserInfo()
    ms.success(t('common.editSuccess'))
  }
  catch (error) {
    ms.error(error instanceof Error ? error.message : t('common.serverError'))
  }
  finally {
    isSavingProfile.value = false
  }
}

function handleUpdatePassword(e: MouseEvent) {
  e.preventDefault()
  formRef.value?.validate((errors) => {
    if (errors) {
      console.warn(errors)
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
  <div
    class="user-info-page"
    :class="embedded
      ? 'embedded-user-center'
      : 'h-full overflow-y-auto p-3 bg-gradient-to-b from-indigo-50/80 via-slate-50 to-slate-100 dark:from-zinc-900 dark:via-zinc-950 dark:to-black'"
  >
    <!-- 个人身份卡片 -->
    <div class="profile-hero relative overflow-hidden rounded-2xl border border-white/40 dark:border-white/10 shadow-lg shadow-indigo-200/40 dark:shadow-black/40" :class="{ 'embedded-profile-hero': embedded }">
      <div v-if="!embedded" class="absolute inset-0 bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500" />
      <div v-if="!embedded" class="absolute -top-10 -right-8 w-44 h-44 rounded-full bg-white/20 blur-3xl" />
      <div v-if="!embedded" class="absolute -bottom-14 -left-6 w-40 h-40 rounded-full bg-sky-300/30 blur-3xl" />

      <div class="relative flex items-center gap-4 p-5">
        <NAvatar
          :key="profileAvatarUrl"
          :size="64"
          :src="profileAvatarUrl || undefined"
          fallback-src="/favicon.svg"
          class="!rounded-2xl !bg-white/20 border border-white/40 backdrop-blur-xl shrink-0 shadow-inner"
        >
          <span class="text-2xl font-black text-white">{{ avatarInitial }}</span>
        </NAvatar>
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
      <div class="profile-editor px-4 pb-4 pt-2 space-y-3">
        <div class="flex items-center justify-between gap-3 py-1.5">
          <span class="text-xs text-slate-400 dark:text-zinc-500">{{ $t('common.username') }}</span>
          <span class="text-sm font-medium text-slate-700 dark:text-zinc-200 truncate">{{ authStore.userInfo?.username || '-' }}</span>
        </div>
        <div class="border-t border-dashed border-slate-200 dark:border-white/[0.06]" />
        <div class="profile-field-grid">
          <label for="profile-nickname">昵称</label>
          <NInput id="profile-nickname" v-model:value="nickName" maxlength="15" show-count type="text" placeholder="昵称（3～15 个字符）" />
        </div>
        <div class="profile-field-grid">
          <label for="profile-email">邮箱</label>
          <NInput id="profile-email" v-model:value="profileMail" maxlength="50" type="text" placeholder="邮箱（可选）" />
        </div>
        <div class="flex items-center gap-3 rounded-xl border border-white/10 bg-black/10 p-3">
          <NAvatar
            :key="draftAvatarUrl"
            :size="52"
            :src="draftAvatarUrl || undefined"
            fallback-src="/favicon.svg"
            class="!rounded-xl shrink-0"
          >
            {{ (nickName || 'U').charAt(0).toUpperCase() }}
          </NAvatar>
          <div class="min-w-0">
            <b class="block truncate text-sm text-slate-700 dark:text-zinc-100">{{ nickName || '未设置昵称' }}</b>
            <small class="block truncate text-slate-400 dark:text-zinc-500">账号：{{ authStore.userInfo?.username || '-' }}</small>
          </div>
        </div>
        <div class="profile-field-grid">
          <label for="profile-avatar">头像地址</label>
          <NInput id="profile-avatar" v-model:value="profileHeadImage" maxlength="200" type="text" placeholder="头像 URL 或服务端素材路径" />
        </div>
        <div class="flex flex-wrap gap-2" aria-label="预设头像">
          <button
            v-for="url in avatarPresets"
            :key="url"
            type="button"
            class="avatar-preset-button"
            :class="{ active: profileHeadImage === url }"
            @click="profileHeadImage = url"
          >
            <img :src="url" alt="预设头像">
          </button>
        </div>
        <div class="flex items-center justify-between gap-3 pt-1">
          <small class="profile-save-hint">{{ isProfileDirty ? '资料尚未保存' : '资料已同步' }}</small>
          <NButton size="small" type="primary" :loading="isSavingProfile" :disabled="!isProfileDirty" @click="handleSaveInfo">
            {{ t('common.save') }}
          </NButton>
        </div>
      </div>
    </section>

    <!-- 偏好设置：扩展控制中心已有独立主题入口，嵌入时不再重复显示旧入口。 -->
    <section v-if="!embedded" class="mt-3 rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.03]">
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

    <RoundCardModal v-model:show="updatePasswordModalState.show" :to="embedded ? '.pn-theme-root' : undefined" size="small" preset="card" style="width: min(400px, calc(100vw - 24px))" :title="$t('settingUserInfo.updatePassword')">
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

<style scoped>
.embedded-user-center {
  min-width: 0;
  padding: 0;
  background: transparent;
}

.embedded-profile-hero {
  color: var(--pn-color-text-primary, inherit);
  border-color: var(--pn-color-border, rgba(148, 163, 184, .24)) !important;
  background: var(--pn-color-surface-hover, rgba(148, 163, 184, .1));
  box-shadow: none !important;
}
.embedded-profile-hero .text-white { color: var(--pn-color-text-primary, inherit) !important; }
.embedded-profile-hero .text-xs { color: var(--pn-color-text-muted, inherit) !important; }

.profile-field-grid {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.profile-field-grid label {
  color: #64748b;
  font-size: 11px;
  font-weight: 650;
}

.profile-save-hint { color: #94a3b8; font-size: 10px; }

:global(html.dark) .profile-field-grid label { color: #94a3b8; }

@media (max-width: 520px) {
  .profile-field-grid { grid-template-columns: 1fr; gap: 5px; }
}

.avatar-preset-button {
  width: 42px;
  height: 42px;
  padding: 3px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, .22);
  border-radius: 12px;
  background: rgba(255, 255, 255, .06);
  cursor: pointer;
  transition: border-color .18s ease, transform .18s ease, background-color .18s ease;
}

.avatar-preset-button:hover,
.avatar-preset-button.active {
  border-color: rgba(52, 211, 153, .72);
  background: rgba(16, 185, 129, .14);
  transform: translateY(-1px);
}

.avatar-preset-button img {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  object-fit: cover;
}
</style>
