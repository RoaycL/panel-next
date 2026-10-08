<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NInput, NModal, NRadioButton, NRadioGroup, NSlider, NSwitch, useMessage } from 'naive-ui'
import { useTheme } from '@/themes/context'
import { themeRegistry } from '@/themes/registry'
import { resolveThemeWallpaper, withThemeWallpaper } from '@/themes/wallpaper'
import { validateThemeWallpapers } from '@/themes/schema'
import type { ResolvedThemeMode } from '@/themes/types'
import UploadFileManager from '@/components/apps/UploadFileManager/index.vue'
import { useAuthStore, usePanelState } from '@/store'
import { getRuntime } from '@/runtime'
import { saveAndSyncExtensionWallpaper } from '@/runtime/extensionWallpaper'
import { enqueueAppearanceSave } from '@/themes/appearanceSaveQueue'
import { set as setUserConfig } from '@/api/panel/userConfig'
import GallerySelector from '@/components/common/GallerySelector/index.vue'
import { preloadWallpaper } from '@/runtime/wallpaperLoader'

defineEmits<{ (event: 'browse'): void }>()
const showGallery = ref(false)
const panel = usePanelState()
const auth = useAuthStore()
let selectionGeneration = 0
const validatingImage = ref(false)
const theme = useTheme()
const editingMode = ref<ResolvedThemeMode>(theme.resolvedMode)
const selection = computed(() => panel.panelConfig.theme ?? themeRegistry.createSelection('core.default', 'auto'))
const selectedUrl = computed(() => resolveThemeWallpaper(selection.value, themeRegistry.get(selection.value.themeId), editingMode.value, panel.panelConfig.backgroundImageSrc))
const urlDraft = ref(selectedUrl.value)
watch(selectedUrl, value => { urlDraft.value = value })
const shared = computed(() => resolveThemeWallpaper(selection.value, themeRegistry.get(selection.value.themeId), 'light', panel.panelConfig.backgroundImageSrc) === resolveThemeWallpaper(selection.value, themeRegistry.get(selection.value.themeId), 'dark', panel.panelConfig.backgroundImageSrc))
const separate = ref(!shared.value)
const message = useMessage()
function setShared(value: boolean) {
  if (value) selectWallpaper(selectedUrl.value, true)
  else {
    const light = resolveThemeWallpaper(selection.value, themeRegistry.get(selection.value.themeId), 'light', panel.panelConfig.backgroundImageSrc)
    const dark = resolveThemeWallpaper(selection.value, themeRegistry.get(selection.value.themeId), 'dark', panel.panelConfig.backgroundImageSrc)
    panel.panelConfig.theme = withThemeWallpaper(withThemeWallpaper(selection.value, 'light', light), 'dark', dark)
    separate.value = true
    void save()
  }
}
function browse() {
  showGallery.value = true
}
async function selectWallpaper(url: string, forceShared = false) {
  const error = validateThemeWallpapers({ light: url })
  if (error) { message.error('请输入有效的图片地址（HTTP/HTTPS 或站内路径）'); return }
  const generation = ++selectionGeneration
  const mode = editingMode.value
  const themeId = selection.value.themeId
  const accountId = auth.userInfo?.id
  const origin = getRuntime().getServerOrigin()
  validatingImage.value = Boolean(url)
  try { await preloadWallpaper(getRuntime().resolveUrl(url)) }
  catch (failure) {
    if (generation === selectionGeneration) { validatingImage.value = false; message.error(failure instanceof Error ? failure.message : '壁纸加载失败') }
    return
  }
  if (generation !== selectionGeneration) return
  validatingImage.value = false
  if (mode !== editingMode.value || themeId !== selection.value.themeId || accountId !== auth.userInfo?.id || origin !== getRuntime().getServerOrigin()) return
  if (forceShared) separate.value = false
  panel.panelConfig.theme = withThemeWallpaper(selection.value, editingMode.value, url, !separate.value)
  showGallery.value = false
  void save()
}
const saving = ref(false)
const imageFailed = ref(false)
const wallpaperUrl = computed(() => selectedUrl.value ? getRuntime().resolveUrl(selectedUrl.value) : '')
watch(wallpaperUrl, () => { imageFailed.value = false })
const imageStyle = computed(() => ({ filter: `blur(${panel.panelConfig.backgroundBlur || 0}px)` }))
const maskStyle = computed(() => ({ opacity: panel.panelConfig.backgroundMaskNumber ?? 0 }))
let timer: ReturnType<typeof setTimeout> | undefined
async function save() {
  if (timer) clearTimeout(timer)
  timer = undefined
  const config = JSON.parse(JSON.stringify(panel.panelConfig)) as Panel.panelConfig
  saving.value = true
  try {
    if (getRuntime().kind === 'web') {
      const result = await enqueueAppearanceSave(() => setUserConfig({ panel: config }))
      if (result.code !== 0) message.error(result.msg || '壁纸设置保存失败，请重试')
      else {
        panel.recordState()
        message.success('壁纸设置已保存')
      }
      return
    }
    const result = await enqueueAppearanceSave(() => saveAndSyncExtensionWallpaper(config))
    if (result.status === 'failed') message.warning(result.message || '壁纸同步失败，请重试')
    else message.success('壁纸设置已保存')
  }
  catch { message.error('壁纸设置保存失败，请重试') }
  finally { saving.value = false }
}
function scheduleSave() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void save() }, 500)
}
function clearWallpaper() {
  selectWallpaper('')
}
onBeforeUnmount(() => { selectionGeneration++; if (timer) void save() })
</script>

<template>
  <section class="wallpaper-settings">
    <p v-if="validatingImage" role="status">
      正在加载壁纸原图，期间保留当前背景…
    </p>
    <div class="wallpaper-overview settings-glass-card">
      <div class="wallpaper-live-preview">
        <img v-if="wallpaperUrl && !imageFailed" :key="wallpaperUrl" :src="wallpaperUrl" :style="imageStyle" alt="当前壁纸预览" @load="imageFailed = false" @error="imageFailed = true">
        <div class="wallpaper-preview-mask" :style="maskStyle" />
        <div class="wallpaper-preview-copy" :class="{ 'with-image': wallpaperUrl && !imageFailed }">
          <strong>12:30</strong><span>{{ imageFailed ? '壁纸暂时无法加载' : wallpaperUrl ? '当前桌面壁纸' : '纯色桌面' }}</span>
          <i /><div class="wallpaper-preview-icons">
            <b /><b /><b /><b />
          </div>
        </div>
      </div>
      <div class="wallpaper-adjustments">
        <h3>主题壁纸</h3><p>当前主题独立保存日/夜壁纸。跟随系统时自动切换，登录后同步。</p>
        <div class="wallpaper-buttons">
          <NRadioGroup v-model:value="editingMode" size="small">
            <NRadioButton value="light">
              日间壁纸
            </NRadioButton><NRadioButton value="dark">
              夜间壁纸
            </NRadioButton>
          </NRadioGroup>
        </div>
        <div class="wallpaper-buttons">
          <NSwitch :value="!separate" @update:value="setShared" /><span>日间与夜间共用壁纸</span>
        </div>
        <NInput v-model:value="urlDraft" placeholder="图片地址，留空为纯色" @change="value => selectWallpaper(value)" />
        <div class="wallpaper-buttons">
          <NButton type="primary" @click="browse">
            浏览壁纸库
          </NButton>
          <NButton :disabled="!wallpaperUrl || saving" @click="clearWallpaper">
            使用纯色
          </NButton>
        </div>
        <label class="wallpaper-slider"><span>背景模糊 <small>{{ panel.panelConfig.backgroundBlur || 0 }} px</small></span><NSlider v-model:value="panel.panelConfig.backgroundBlur" :min="0" :max="20" :step="1" @update:value="scheduleSave" /></label>
        <label class="wallpaper-slider"><span>暗色遮罩 <small>{{ Math.round((panel.panelConfig.backgroundMaskNumber || 0) * 100) }}%</small></span><NSlider v-model:value="panel.panelConfig.backgroundMaskNumber" :min="0" :max="1" :step="0.05" @update:value="scheduleSave" /></label>
      </div>
    </div>
    <section class="settings-glass-card wallpaper-uploads">
      <div class="wallpaper-section-heading">
        <h3>我的壁纸</h3><p>上传的壁纸单独管理，不再混在图标素材中。</p>
      </div>
      <UploadFileManager mode="wallpaper" :wallpaper-url="selectedUrl" @select-wallpaper="selectWallpaper" />
    </section>
  </section>
  <NModal v-if="showGallery" v-model:show="showGallery" to=".pn-theme-root" preset="card" title="选择壁纸" style="width: min(960px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto;">
    <GallerySelector type="wallpaper" @select="selectWallpaper" />
  </NModal>
</template>

<style scoped>
.wallpaper-settings { display: grid; gap: 20px; }
.wallpaper-settings .settings-glass-card { padding: 22px; border: 1px solid var(--pn-glass-border); border-radius: 20px; background: var(--pn-glass-panel); box-shadow: var(--pn-glass-highlight); }
.wallpaper-overview { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(230px, 1fr); gap: 24px; align-items: start; }
.wallpaper-live-preview { position: relative; overflow: hidden; aspect-ratio: 16 / 11; border-radius: 16px; background: var(--pn-color-page-background); border: 1px solid var(--pn-glass-border); }
.wallpaper-live-preview > img { position: absolute; inset: -6%; width: 112%; height: 112%; max-width: none; object-fit: cover; }
.wallpaper-preview-mask { position: absolute; inset: 0; background: #000; }
.wallpaper-preview-copy { position: relative; display: flex; align-items: center; flex-direction: column; padding: 24px; color: var(--pn-color-text-primary); }
.wallpaper-preview-copy.with-image { color: #fff; text-shadow: 0 1px 3px #0008; }
.wallpaper-preview-copy strong { font-size: 38px; font-weight: 300; letter-spacing: -.04em; }
.wallpaper-preview-copy span { margin-top: 4px; font-size: 11px; }
.wallpaper-preview-copy > i { width: 75%; height: 20px; margin: 22px 0; border-radius: 10px; background: var(--pn-glass-control); }
.wallpaper-preview-icons { display: flex; gap: 14px; }
.wallpaper-preview-icons b { width: 30px; height: 30px; border-radius: 9px; background: var(--pn-glass-control); border: 1px solid var(--pn-glass-border); }
.wallpaper-adjustments h3, .wallpaper-section-heading h3 { margin: 0; font-size: 16px; color: var(--pn-color-text-primary); }
.wallpaper-adjustments p, .wallpaper-section-heading p { margin: 8px 0 18px; font-size: 12px; line-height: 1.6; color: var(--pn-color-text-muted); }
.wallpaper-buttons { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.wallpaper-slider { display: grid; gap: 10px; margin-top: 16px; }
.wallpaper-slider > span { display: flex; justify-content: space-between; color: var(--pn-color-text-secondary); font-size: 12px; }
.wallpaper-slider small { color: var(--pn-color-text-muted); }
@media (max-width: 850px) { .wallpaper-overview { grid-template-columns: minmax(0, 1fr); } .wallpaper-live-preview { aspect-ratio: 16 / 9; } }
</style>
