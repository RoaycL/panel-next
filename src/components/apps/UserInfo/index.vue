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
import { createDefaultSelection } from '@/themes/legacyAdapter'
import { persistThemeSelection } from '@/themes/storage'
import { themeRegistry } from '@/themes/registry'

const { embedded = false } = defineProps<{ embedded?: boolean }>()

const userStore = useUserStore()
const authStore = useAuthStore()
const appStore = useAppStore()
const panelState = usePanelState()
const ms = useMessage()
const dialog = useDialog()
const runtime = getRuntime()

const languageValue = ref<Language>(appStore.language)
const themeValue = computed<Theme>(() => panelState.panelConfig.theme?.mode ?? appStore.theme)
const themeChanging = ref(false)
const nickName = ref(authStore.userInfo?.name || authStore.userInfo?.username || '')
const profileMail = ref(authStore.userInfo?.mail || '')
const profileHeadImage = ref(authStore.userInfo?.headImage || '')
const isSavingProfile = ref(false)
const formRef = ref<FormInst | null>(null)

const isAdmin = computed(() => authStore.userInfo?.role === 1)
const displayName = computed(() => authStore.userInfo?.name || authStore.userInfo?.username || t('apps.userInfo.guestTitle'))
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

async function handleChangeTheme(value: Theme) {
  if (themeChanging.value || themeValue.value === value)
    return
  themeChanging.value = true
  try {
    const selection = themeRegistry.serialize({
      ...(panelState.panelConfig.theme ?? createDefaultSelection(value)),
      mode: value,
    })
    if (!selection)
      throw new Error('Theme selection was rejected.')
    if (authStore.token) {
      const result = await persistThemeSelection({ surface: runtime.kind, serialized: selection })
      if (!result.ok || result.conflict) {
        ms.error(t('theme.saveFailed'))
        return
      }
    }
    else {
      panelState.panelConfig = { ...panelState.panelConfig, theme: selection }
      panelState.recordState()
    }
    appStore.setTheme(value)
    ms.success(t('theme.saved'))
  }
  catch (error) {
    ms.error(t('theme.saveFailed'))
    console.error('Failed to change theme mode.', error)
  }
  finally {
    themeChanging.value = false
  }
}
</script>

<template>
  <div
    class="pn-app-page user-info-page"
    :class="embedded
      ? 'embedded-user-center'
      : 'h-full overflow-y-auto p-3'"
  >
    <!-- 个人身份卡片 -->
    <div class="profile-hero relative overflow-hidden" :class="{ 'embedded-profile-hero': embedded }">
      <div class="relative flex items-center gap-4 p-5">
        <NAvatar
          :key="profileAvatarUrl"
          :size="64"
          :src="profileAvatarUrl || undefined"
          fallback-src="/favicon.svg"
          class="profile-avatar shrink-0"
        >
          <span class="text-2xl font-black">{{ avatarInitial }}</span>
        </NAvatar>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="profile-name text-lg font-bold truncate">{{ displayName }}</span>
            <span
              v-if="authStore.token"
              class="profile-role shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide"
              :class="{ 'profile-role-admin': isAdmin }"
            >
              {{ isAdmin ? t('apps.userInfo.roleAdmin') : t('apps.userInfo.roleUser') }}
            </span>
          </div>
          <div class="profile-account mt-0.5 text-xs truncate">
            {{ authStore.token ? `@${authStore.userInfo?.username || '-'}` : t('apps.userInfo.guestDescription') }}
          </div>
        </div>
      </div>
    </div>

    <!-- 个人资料 -->
    <section v-if="!authStore.token" class="pn-app-panel guest-profile-panel mt-3">
      <h3 class="pn-app-heading">
        {{ t('apps.userInfo.guestTitle') }}
      </h3>
      <p class="pn-app-muted">
        {{ t('apps.userInfo.guestDescription') }}
      </p>
      <NButton type="primary" @click="$router.push('/login')">
        {{ t('apps.userInfo.guestAction') }}
      </NButton>
    </section>

    <section v-if="authStore.token" class="pn-app-panel mt-3">
      <header class="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <SvgIcon icon="material-symbols-person-edit-outline-rounded" class="pn-app-heading-icon" />
        <h3 class="pn-app-heading">
          {{ t('apps.userInfo.profile') }}
        </h3>
      </header>
      <div class="profile-editor px-4 pb-4 pt-2 space-y-3">
        <div class="flex items-center justify-between gap-3 py-1.5">
          <span class="pn-app-muted text-xs">{{ $t('common.username') }}</span>
          <span class="text-sm font-medium truncate">{{ authStore.userInfo?.username || '-' }}</span>
        </div>
        <div class="profile-divider" />
        <div class="profile-field-grid">
          <label for="profile-nickname">昵称</label>
          <NInput id="profile-nickname" v-model:value="nickName" maxlength="15" show-count type="text" placeholder="昵称（3～15 个字符）" />
        </div>
        <div class="profile-field-grid">
          <label for="profile-email">邮箱</label>
          <NInput id="profile-email" v-model:value="profileMail" maxlength="50" type="text" placeholder="邮箱（可选）" />
        </div>
        <div class="profile-preview flex items-center gap-3 p-3">
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
            <b class="block truncate text-sm">{{ nickName || '未设置昵称' }}</b>
            <small class="pn-app-muted block truncate">账号：{{ authStore.userInfo?.username || '-' }}</small>
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
    <section v-if="!embedded" class="pn-app-panel mt-3">
      <header class="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <SvgIcon icon="ion-color-palette-outline" class="pn-app-heading-icon" />
        <h3 class="pn-app-heading">
          {{ t('apps.userInfo.preferences') }}
        </h3>
      </header>
      <div class="px-4 pb-4 space-y-3">
        <div class="flex items-center justify-between gap-3 py-1.5">
          <span class="pn-app-muted shrink-0 text-xs">{{ $t('apps.userInfo.theme') }}</span>
          <div class="profile-theme-segments flex items-center gap-1 p-1">
            <button
              v-for="segment in themeSegments"
              :key="segment.key"
              type="button"
              class="profile-theme-segment flex items-center justify-center w-9 h-7 transition-all duration-200"
              :class="{ active: themeValue === segment.key }"
              :disabled="themeChanging"
              :title="t(`apps.userInfo.themeStyle.${segment.key}`)"
              @click="handleChangeTheme(segment.key)"
            >
              <SvgIcon :icon="segment.icon" />
            </button>
          </div>
        </div>
        <div class="profile-divider" />
        <div class="flex items-center justify-between gap-3 py-1.5">
          <span class="pn-app-muted shrink-0 text-xs">{{ $t('common.language') }}</span>
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
    <section v-if="authStore.token" class="pn-app-panel mt-3">
      <header class="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <SvgIcon icon="mdi-shield-key-outline" class="pn-app-heading-icon" />
        <h3 class="pn-app-heading">
          {{ t('apps.userInfo.security') }}
        </h3>
      </header>
      <div class="px-4 pb-4">
        <button
          type="button"
          class="group flex items-center justify-between w-full py-2.5 text-left"
          @click="updatePasswordModalState.show = true"
        >
          <span class="profile-security-action flex items-center gap-2 text-sm transition-colors">
            <SvgIcon icon="mdi-password-outline" />
            {{ $t('settingUserInfo.updatePassword') }}
          </span>
          <SvgIcon icon="mdi-chevron-right" class="profile-security-action-icon transition-colors" />
        </button>
      </div>
    </section>

    <!-- 退出登录 -->
    <NButton
      v-if="authStore.token"
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

.profile-hero {
  border: 1px solid var(--pn-color-border, rgba(148, 163, 184, .24));
  border-radius: var(--pn-radius-large, 18px);
  color: var(--pn-color-text-primary, #0f172a);
  background: linear-gradient(120deg, color-mix(in srgb, var(--pn-color-accent, #10b981) 19%, var(--pn-color-surface, #fff)), var(--pn-color-surface, #fff) 75%);
  box-shadow: var(--pn-effect-shadow-low, 0 2px 10px rgba(2, 6, 23, .06));
}

.embedded-profile-hero {
  background: var(--pn-color-surface-hover, rgba(148, 163, 184, .1));
}

.profile-avatar {
  border: 1px solid var(--pn-color-border, rgba(148, 163, 184, .24));
  border-radius: var(--pn-radius-medium, 12px) !important;
  color: var(--pn-color-accent, #10b981);
  background: var(--pn-color-surface, #fff);
}

.profile-name,
.profile-preview b { color: var(--pn-color-text-primary, #0f172a); }
.profile-account { color: var(--pn-color-text-muted, #64748b); }
.profile-role { color: var(--pn-color-accent, #10b981); background: color-mix(in srgb, var(--pn-color-accent, #10b981) 14%, transparent); }
.profile-role-admin { color: var(--pn-color-warning, #d97706); background: color-mix(in srgb, var(--pn-color-warning, #d97706) 14%, transparent); }
.profile-divider { border-top: 1px dashed var(--pn-color-border, rgba(148, 163, 184, .24)); }
.profile-preview { border: 1px solid var(--pn-color-border, rgba(148, 163, 184, .24)); border-radius: var(--pn-radius-medium, 12px); background: var(--pn-color-surface-hover, rgba(148, 163, 184, .08)); }
.profile-theme-segments { border-radius: var(--pn-radius-medium, 12px); background: var(--pn-color-surface-hover, rgba(148, 163, 184, .08)); }
.profile-theme-segment { border: 0; border-radius: var(--pn-radius-small, 8px); color: var(--pn-color-text-muted, #64748b); background: transparent; cursor: pointer; }
.profile-theme-segment:hover { color: var(--pn-color-text-primary, #0f172a); }
.profile-theme-segment.active { color: var(--pn-color-accent, #10b981); background: var(--pn-color-surface, #fff); box-shadow: var(--pn-effect-shadow-low, 0 1px 3px rgba(2, 6, 23, .08)); }
.profile-security-action { color: var(--pn-color-text-secondary, #475569); }
.group:hover .profile-security-action, .group:focus-visible .profile-security-action { color: var(--pn-color-accent, #10b981); }
.profile-security-action-icon { color: var(--pn-color-text-muted, #64748b); }
.group:hover .profile-security-action-icon, .group:focus-visible .profile-security-action-icon { color: var(--pn-color-accent, #10b981); }
.guest-profile-panel { padding: 20px; }
.guest-profile-panel p { margin: 0 0 16px; font-size: 13px; line-height: 1.6; }

.profile-field-grid {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.profile-field-grid label {
  color: var(--pn-color-text-muted, #64748b);
  font-size: 11px;
  font-weight: 650;
}

.profile-save-hint { color: var(--pn-color-text-muted, #64748b); font-size: 10px; }

@media (max-width: 520px) {
  .profile-field-grid { grid-template-columns: 1fr; gap: 5px; }
}

.avatar-preset-button {
  width: 42px;
  height: 42px;
  padding: 3px;
  overflow: hidden;
  border: 1px solid var(--pn-color-border, rgba(148, 163, 184, .24));
  border-radius: var(--pn-radius-medium, 12px);
  background: var(--pn-color-surface, #fff);
  cursor: pointer;
  transition: border-color .18s ease, transform .18s ease, background-color .18s ease;
}

.avatar-preset-button:hover,
.avatar-preset-button.active {
  border-color: var(--pn-color-accent, #10b981);
  background: color-mix(in srgb, var(--pn-color-accent, #10b981) 14%, var(--pn-color-surface, #fff));
  transform: translateY(-1px);
}

.avatar-preset-button img {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  object-fit: cover;
}
</style>
