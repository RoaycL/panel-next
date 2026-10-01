<script setup lang="ts">
import { NButton, NCard, NInput, NSwitch, NUpload, NUploadDragger, useMessage } from 'naive-ui'
import { getAccountSettings, setAccountSettings } from '@/api/system/user'
import { onMounted, ref } from 'vue'
import { getRuntime } from '@/runtime'
import { useAuthStore } from '@/store'
import { getSiteSetting, setSiteSetting } from '@/api/site'
import type { SiteBranding } from '@/api/site'
import { getImgbedConfig, setImgbedConfig, testImgbedConfig } from '@/api/imgbed'
import { SvgIcon } from '@/components/common'
import { t } from '@/locales'

const authStore = useAuthStore()
const ms = useMessage()
const loading = ref(false)
const showFaviconInput = ref(false)
const showBackgroundInput = ref(false)
const openRegister = ref(false)
const accountSettingsReady = ref(false)
const savingAccountSettings = ref(false)

async function loadAccountSettings() {
  try {
    const result = await getAccountSettings()
    if (result.code === 0) { openRegister.value = result.data.openRegister; accountSettingsReady.value = true }
  }
  catch { ms.error(t('common.networkError')) }
}
async function saveRegistration(value: boolean) {
  savingAccountSettings.value = true
  try {
    const result = await setAccountSettings(value)
    if (result.code === 0) { openRegister.value = result.data.openRegister; ms.success(t('common.success')) }
    else ms.error(result.msg || t('common.failed'))
  }
  catch { ms.error(t('common.networkError')) }
  finally { savingAccountSettings.value = false }
}

// 图床配置
const imgbedConfig = ref<{ baseUrl: string; token: string }>({ baseUrl: '', token: '' })
const imgbedConfigured = ref(false)
const imgbedSaving = ref(false)
const imgbedTesting = ref(false)

async function fetchImgbedConfig() {
  const res = await getImgbedConfig()
  if (res.code === 0 && res.data) {
    imgbedConfig.value = { baseUrl: res.data.baseUrl, token: res.data.token }
    imgbedConfigured.value = res.data.configured
  }
}

async function saveImgbedConfig() {
  imgbedSaving.value = true
  try {
    const res = await setImgbedConfig(imgbedConfig.value)
    if (res.code === 0) {
      ms.success(t('apps.siteSettings.imgbedSaveSuccess'))
      imgbedConfig.value = { baseUrl: res.data.baseUrl, token: res.data.token }
      imgbedConfigured.value = res.data.configured
    }
    else {
      ms.error(`${t('apps.siteSettings.imgbedSaveFail')}:${res.msg}`)
    }
  }
  finally {
    imgbedSaving.value = false
  }
}

async function testImgbedConnection() {
  imgbedTesting.value = true
  try {
    const res = await testImgbedConfig()
    if (res.code === 0) {
      ms.success(t('apps.siteSettings.imgbedTestSuccess'))
    }
    else {
      ms.error(`${t('apps.siteSettings.imgbedTestFail')}:${res.msg}`)
    }
  }
  finally {
    imgbedTesting.value = false
  }
}

const siteSetting = ref<SiteBranding>({
  siteTitle: '',
  siteFavicon: '',
  loginBackground: '',
  globalIndexCss: '',
  globalIndexJs: '',
})

const uploadAction = getRuntime().resolveUrl('/api/file/uploadImg')

async function fetchSiteSetting() {
  const res = await getSiteSetting()
  if (res.code === 0 && res.data) {
    siteSetting.value = res.data
  }
}

function handleUploadFinish({ file }: { file: any }) {
  const res = JSON.parse((file.event?.target as XMLHttpRequest)?.response || '{}')
  if (res.code === 0 && res.data?.imageUrl) {
    siteSetting.value.siteFavicon = res.data.imageUrl
    return
  }
  ms.error(t('apps.siteSettings.saveFail'))
}

function handleBackgroundUploadFinish({ file }: { file: any }) {
  const res = JSON.parse((file.event?.target as XMLHttpRequest)?.response || '{}')
  if (res.code === 0 && res.data?.imageUrl) {
    siteSetting.value.loginBackground = res.data.imageUrl
    return
  }
  ms.error(t('apps.siteSettings.saveFail'))
}

function handleSave() {
  loading.value = true
  setSiteSetting(siteSetting.value).then(({ code, msg }) => {
    loading.value = false
    if (code === 0) {
      ms.success(t('apps.siteSettings.saveSuccess'))
      document.title = siteSetting.value.siteTitle || t('common.appName')
    }
    else {
      ms.error(`${t('apps.siteSettings.saveFail')}:${msg}`)
    }
  }).catch(() => {
    loading.value = false
    ms.error(t('apps.siteSettings.saveFail'))
  })
}

onMounted(() => {
  void loadAccountSettings()
  fetchSiteSetting()
  fetchImgbedConfig()
})
</script>

<template>
  <div class="pn-app-page site-settings-container flex flex-col gap-3.5">
    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ t('login.accountSettings') }}
      </div>
      <p class="pn-app-muted">
        {{ t('login.registrationSettingsHint') }}
      </p>
      <NSwitch :value="openRegister" :disabled="!accountSettingsReady || savingAccountSettings" :loading="savingAccountSettings" @update:value="saveRegistration" />
      <span class="ml-2">{{ t('login.openRegistration') }}</span>
    </NCard>
    <!-- 站点名称 -->
    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ t('apps.siteSettings.siteTitle') }}
      </div>
      <div class="mt-2">
        <NInput
          v-model:value="siteSetting.siteTitle"
          type="text"
          show-count
          :maxlength="80"
          :placeholder="t('apps.siteSettings.siteTitlePlaceholder')"
        />
      </div>
    </NCard>

    <!-- 站点图标 (Favicon) -->
    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ t('apps.siteSettings.favicon') }}
      </div>
      <div class="mt-2">
        <NUpload
          :action="uploadAction"
          :show-file-list="false"
          name="imgfile"
          accept=".ico,.png,.svg,.jpg,.jpeg,.avif"
          :headers="{
            Authorization: `Bearer ${authStore.token}`,
            token: authStore.token as string,
          }"
          :directory-dnd="true"
          @finish="handleUploadFinish"
        >
          <NUploadDragger class="dropzone-dragger">
            <div
              class="pn-app-dropzone dropzone-box group"
              :style="{
                backgroundImage: siteSetting.siteFavicon ? `url(${siteSetting.siteFavicon})` : undefined,
                backgroundSize: 'contain',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
              }"
            >
              <!-- 存在图标时的悬浮遮罩 -->
              <div v-if="siteSetting.siteFavicon" class="dropzone-hover-overlay">
                <SvgIcon icon="tabler:cloud-upload" class="text-lg" />
                <span>{{ t('apps.siteSettings.clickChangeIcon') }}</span>
              </div>
              <!-- 未设置时的清晰提示 -->
              <div v-else class="dropzone-empty-prompt">
                <div class="dropzone-icon-circle">
                  <SvgIcon icon="tabler:cloud-upload" class="text-xl" />
                </div>
                <div class="dropzone-text-main">
                  {{ t('apps.siteSettings.uploadOrDragText') }}
                </div>
                <div class="dropzone-text-sub">
                  {{ t('apps.siteSettings.supportIconFormats') }}
                </div>
              </div>
            </div>
          </NUploadDragger>
        </NUpload>
      </div>
      <div v-if="showFaviconInput" class="site-setting-url-row flex items-center gap-2.5 mt-3 pt-2">
        <span class="pn-app-muted text-xs whitespace-nowrap">{{ t('apps.siteSettings.customImageAddress') }}:</span>
        <NInput v-model:value="siteSetting.siteFavicon" size="small" type="text" :placeholder="t('apps.siteSettings.customImagePlaceholder')" />
      </div>
    </NCard>

    <!-- 登录页背景图 -->
    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ t('apps.siteSettings.loginBackground') }}
      </div>
      <div class="mt-2">
        <NUpload
          :action="uploadAction"
          :show-file-list="false"
          name="imgfile"
          accept=".webp,.png,.jpg,.jpeg,.gif,.svg,.avif"
          :headers="{
            Authorization: `Bearer ${authStore.token}`,
            token: authStore.token as string,
          }"
          :directory-dnd="true"
          @finish="handleBackgroundUploadFinish"
        >
          <NUploadDragger class="dropzone-dragger">
            <div
              class="pn-app-dropzone dropzone-box group"
              :style="{
                backgroundImage: siteSetting.loginBackground ? `url(${siteSetting.loginBackground})` : undefined,
                backgroundSize: 'cover',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
              }"
            >
              <div v-if="siteSetting.loginBackground" class="dropzone-hover-overlay">
                <SvgIcon icon="tabler:photo-up" class="text-lg" />
                <span>{{ t('apps.siteSettings.clickChangeWallpaper') }}</span>
              </div>
              <div v-else class="dropzone-empty-prompt">
                <div class="dropzone-icon-circle">
                  <SvgIcon icon="tabler:photo-up" class="text-xl" />
                </div>
                <div class="dropzone-text-main">
                  {{ t('apps.siteSettings.uploadOrDragText') }}
                </div>
                <div class="dropzone-text-sub">
                  {{ t('apps.siteSettings.supportWallpaperFormats') }}
                </div>
              </div>
            </div>
          </NUploadDragger>
        </NUpload>
      </div>
      <div v-if="showBackgroundInput" class="site-setting-url-row flex items-center gap-2.5 mt-3 pt-2">
        <span class="pn-app-muted text-xs whitespace-nowrap">{{ t('apps.siteSettings.customImageAddress') }}:</span>
        <NInput v-model:value="siteSetting.loginBackground" size="small" type="text" :placeholder="t('apps.siteSettings.customImagePlaceholder')" />
      </div>
    </NCard>

    <!-- 全局 CSS -->
    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ t('apps.siteSettings.globalCss') }}
      </div>
      <div class="mt-2">
        <NInput
          v-model:value="siteSetting.globalIndexCss"
          type="textarea"
          :rows="6"
          :placeholder="t('apps.siteSettings.globalCssPlaceholder')"
          style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"
        />
      </div>
    </NCard>

    <!-- 全局 JS -->
    <NCard class="pn-app-card" size="small">
      <div class="pn-app-heading">
        {{ t('apps.siteSettings.globalJs') }}
      </div>
      <div class="mt-2">
        <NInput
          v-model:value="siteSetting.globalIndexJs"
          type="textarea"
          :rows="6"
          :placeholder="t('apps.siteSettings.globalJsPlaceholder')"
          style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"
        />
      </div>
    </NCard>

    <!-- 操作按钮组 -->
    <div class="pn-app-actions pt-1">
      <NButton type="primary" :loading="loading" @click="handleSave">
        {{ t('apps.siteSettings.save') }}
      </NButton>
      <NButton secondary @click="showFaviconInput = !showFaviconInput">
        {{ t('apps.siteSettings.editFavicon') }}
      </NButton>
      <NButton secondary @click="showBackgroundInput = !showBackgroundInput">
        {{ t('apps.siteSettings.editBackground') }}
      </NButton>
    </div>

    <!-- 图床设置 -->
    <NCard class="pn-app-card mt-2" size="small">
      <div class="flex items-center justify-between">
        <div class="pn-app-heading flex flex-wrap items-center gap-2">
          <span>{{ t('apps.siteSettings.imgbedTitle') }}</span>
          <span v-if="imgbedConfigured" class="imgbed-status configured text-xs px-2 py-0.5 rounded-full">
            ● {{ t('apps.siteSettings.imgbedConfigured') }}
          </span>
          <span v-else class="imgbed-status text-xs px-2 py-0.5 rounded-full">
            ○ {{ t('apps.siteSettings.imgbedNotConfigured') }}
          </span>
        </div>
      </div>
      <div class="pn-app-muted text-xs mt-1 mb-3">
        {{ t('apps.siteSettings.imgbedDescription') }}
      </div>
      <div class="flex flex-col gap-3">
        <div>
          <div class="pn-app-muted text-xs mb-1">
            {{ t('apps.siteSettings.imgbedBaseUrl') }}
          </div>
          <NInput
            v-model:value="imgbedConfig.baseUrl"
            type="text"
            :placeholder="t('apps.siteSettings.imgbedBaseUrlPlaceholder')"
          />
        </div>
        <div>
          <div class="pn-app-muted text-xs mb-1">
            {{ t('apps.siteSettings.imgbedToken') }}
          </div>
          <NInput
            v-model:value="imgbedConfig.token"
            type="password"
            show-password-on="click"
            :placeholder="t('apps.siteSettings.imgbedTokenPlaceholder')"
          />
        </div>
      </div>
      <div class="pn-app-actions mt-3 pt-2">
        <NButton type="primary" :loading="imgbedSaving" @click="saveImgbedConfig">
          {{ t('apps.siteSettings.imgbedSave') }}
        </NButton>
        <NButton secondary :loading="imgbedTesting" :disabled="!imgbedConfigured" @click="testImgbedConnection">
          {{ t('apps.siteSettings.imgbedTest') }}
        </NButton>
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.site-settings-container {
  width: 100%;
}

.site-setting-url-row { border-top: 1px solid var(--pn-color-border, rgba(148, 163, 184, .24)); }
.site-setting-url-row :deep(.n-input) { min-width: 0; }
.imgbed-status { border: 1px solid var(--pn-color-border, rgba(148, 163, 184, .24)); color: var(--pn-color-text-muted, #64748b); background: var(--pn-color-surface-hover, rgba(148, 163, 184, .08)); }
.imgbed-status.configured { border-color: color-mix(in srgb, var(--pn-color-success, #10b981) 40%, transparent); color: var(--pn-color-success, #10b981); background: color-mix(in srgb, var(--pn-color-success, #10b981) 13%, transparent); }

:deep(.dropzone-dragger) {
  width: 100% !important;
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
}

.dropzone-box {
  height: 130px;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

.dropzone-empty-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px;
  text-align: center;
}

.dropzone-icon-circle {
  width: 38px;
  height: 38px;
  border-radius: 9999px;
  color: var(--pn-color-accent, #10b981);
  background: color-mix(in srgb, var(--pn-color-accent, #10b981) 15%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dropzone-text-main {
  font-size: 13px;
  font-weight: 500;
  color: var(--pn-color-text-primary, #0f172a);
}

.dropzone-text-sub {
  font-size: 11px;
  color: var(--pn-color-text-muted, #64748b);
}

.dropzone-hover-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #ffffff;
  font-size: 13px;
  font-weight: 500;
}

.dropzone-box:hover .dropzone-hover-overlay,
.dropzone-box:focus-within .dropzone-hover-overlay {
  opacity: 1;
}

@media (max-width: 560px) {
  .site-setting-url-row { align-items: stretch; flex-direction: column; gap: 6px; }
}
</style>
