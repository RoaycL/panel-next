<script setup lang="ts">
import { NButton, NCard, NInput, NUpload, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { getRuntime } from '@/runtime'
import { useAuthStore } from '@/store'
import { getSiteSetting, setSiteSetting  } from '@/api/site'
import type {SiteBranding} from '@/api/site';
import { getImgbedConfig, setImgbedConfig, testImgbedConfig } from '@/api/imgbed'
import { t } from '@/locales'

const authStore = useAuthStore()
const ms = useMessage()
const loading = ref(false)
const showFaviconInput = ref(false)
const showBackgroundInput = ref(false)

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
    } else {
      ms.error(`${t('apps.siteSettings.imgbedSaveFail')}:${res.msg}`)
    }
  } finally {
    imgbedSaving.value = false
  }
}

async function testImgbedConnection() {
  imgbedTesting.value = true
  try {
    const res = await testImgbedConfig()
    if (res.code === 0) {
      ms.success(t('apps.siteSettings.imgbedTestSuccess'))
    } else {
      ms.error(`${t('apps.siteSettings.imgbedTestFail')}:${res.msg}`)
    }
  } finally {
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
  fetchSiteSetting()
  fetchImgbedConfig()
})
</script>

<template>
  <div class="bg-slate-200 dark:bg-zinc-900 rounded-[10px] p-[8px] overflow-auto">
    <NCard style="border-radius:10px" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ t('apps.siteSettings.siteTitle') }}
      </div>
      <div class="flex items-center mt-[5px]">
        <NInput v-model:value="siteSetting.siteTitle" type="text" show-count :maxlength="80" :placeholder="t('apps.siteSettings.siteTitlePlaceholder')" />
      </div>
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ t('apps.siteSettings.favicon') }}
      </div>
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
        <NUploadDragger style="width: 100%;">
          <div
            class="h-[120px] w-full border bg-slate-100 flex justify-center items-center cursor-pointer rounded-[10px]"
            :style="{ background: siteSetting.siteFavicon ? `url(${siteSetting.siteFavicon}) no-repeat center/cover` : undefined }"
          >
            <div v-if="!siteSetting.siteFavicon" class="text-shadow text-white">
              {{ t('apps.siteSettings.uploadOrDragText') }}
            </div>
          </div>
        </NUploadDragger>
      </NUpload>
      <div v-if="showFaviconInput" class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ t('apps.siteSettings.customImageAddress') }}</span>
        <NInput v-model:value="siteSetting.siteFavicon" type="text" :placeholder="t('apps.siteSettings.customImagePlaceholder')" />
      </div>
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ t('apps.siteSettings.loginBackground') }}
      </div>
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
        <NUploadDragger style="width: 100%;">
          <div
            class="h-[120px] w-full border bg-slate-100 flex justify-center items-center cursor-pointer rounded-[10px]"
            :style="{ background: siteSetting.loginBackground ? `url(${siteSetting.loginBackground}) no-repeat center/cover` : undefined }"
          >
            <div v-if="!siteSetting.loginBackground" class="text-shadow text-white">
              {{ t('apps.siteSettings.uploadOrDragText') }}
            </div>
          </div>
        </NUploadDragger>
      </NUpload>
      <div v-if="showBackgroundInput" class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ t('apps.siteSettings.customImageAddress') }}</span>
        <NInput v-model:value="siteSetting.loginBackground" type="text" :placeholder="t('apps.siteSettings.customImagePlaceholder')" />
      </div>
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ t('apps.siteSettings.globalCss') }}
      </div>
      <NInput
        v-model:value="siteSetting.globalIndexCss"
        type="textarea"
        :rows="8"
        :placeholder="t('apps.siteSettings.globalCssPlaceholder')"
        style="font-family: monospace;"
      />
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ t('apps.siteSettings.globalJs') }}
      </div>
      <NInput
        v-model:value="siteSetting.globalIndexJs"
        type="textarea"
        :rows="8"
        :placeholder="t('apps.siteSettings.globalJsPlaceholder')"
        style="font-family: monospace;"
      />
    </NCard>

    <div class="mt-[10px] flex gap-[10px]">
      <NButton type="primary" :loading="loading" @click="handleSave">
        {{ t('apps.siteSettings.save') }}
      </NButton>
      <NButton @click="showFaviconInput = !showFaviconInput">
        {{ t('apps.siteSettings.editFavicon') }}
      </NButton>
      <NButton @click="showBackgroundInput = !showBackgroundInput">
        {{ t('apps.siteSettings.editBackground') }}
      </NButton>
    </div>

    <NCard style="border-radius:10px" class="mt-[20px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ t('apps.siteSettings.imgbedTitle') }}
        <span v-if="imgbedConfigured" class="ml-2 text-green-500 text-sm">● {{ t('apps.siteSettings.imgbedConfigured') }}</span>
        <span v-else class="ml-2 text-gray-400 text-sm">○ {{ t('apps.siteSettings.imgbedNotConfigured') }}</span>
      </div>
      <div class="text-slate-400 text-xs mb-[10px]">
        {{ t('apps.siteSettings.imgbedDescription') }}
      </div>
      <div class="mb-[10px]">
        <div class="text-slate-500 mb-[2px]">
          {{ t('apps.siteSettings.imgbedBaseUrl') }}
        </div>
        <NInput
          v-model:value="imgbedConfig.baseUrl"
          type="text"
          :placeholder="t('apps.siteSettings.imgbedBaseUrlPlaceholder')"
        />
      </div>
      <div class="mb-[10px]">
        <div class="text-slate-500 mb-[2px]">
          {{ t('apps.siteSettings.imgbedToken') }}
        </div>
        <NInput
          v-model:value="imgbedConfig.token"
          type="password"
          show-password-on="click"
          :placeholder="t('apps.siteSettings.imgbedTokenPlaceholder')"
        />
      </div>
      <div class="flex gap-[10px]">
        <NButton type="primary" :loading="imgbedSaving" @click="saveImgbedConfig">
          {{ t('apps.siteSettings.imgbedSave') }}
        </NButton>
        <NButton :loading="imgbedTesting" :disabled="!imgbedConfigured" @click="testImgbedConnection">
          {{ t('apps.siteSettings.imgbedTest') }}
        </NButton>
      </div>
    </NCard>
  </div>
</template>
