<script setup lang="ts">
import type { ThemeFieldDescriptor, ThemeMode, ThemeSelection } from './types'
import { computed, reactive, ref, watch } from 'vue'
import { NAlert, NButton, NColorPicker, NDatePicker, NInput, NInputNumber, NModal, NRadioButton, NRadioGroup, NSelect, NSwitch, useMessage } from 'naive-ui'
import { t } from '@/locales'
import { DEFAULT_ICON_PACK_ID, DEFAULT_THEME_ID } from './constants'
import { themeRegistry } from './registry'
import { persistThemeSelection, saveLastKnownGood } from './storage'
import { setThemePreview, getThemePreview, getThemeRuntimeState } from './runtime'
import { coerceVariant, DEFAULT_VARIANTS, VARIANT_LABEL_KEYS } from './variants'
import { cloneJson } from './clone'

/**
 * 主题中心：
 * - 实时预览但不立即持久化；取消恢复原主题和原配置；
 * - 确认时先校验再原子保存；成功更新 Last Known Good，失败恢复并显示错误；
 * - 支持一键恢复 core.default。
 */
const props = defineProps<{
  show: boolean
  surface: 'web' | 'extension'
  currentSelection: ThemeSelection | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  /** 预览选择变化；null 表示取消预览。 */
  'preview': [selection: ThemeSelection | null]
  'saved': [selection: ThemeSelection]
}>()

const ms = useMessage()
const saving = ref(false)

const draft = reactive<{
  themeId: string
  mode: ThemeMode
  config: Record<string, unknown>
  variants: Record<string, string>
  iconPackId: string
}>({
  themeId: DEFAULT_THEME_ID,
  mode: 'auto',
  config: {},
  variants: {},
  iconPackId: DEFAULT_ICON_PACK_ID,
})

watch(() => props.show, (show) => {
  if (!show)
    return
  const source = props.currentSelection
  // 主题中心不能出现当前 surface 不支持的当前值：若当前选择对应的主题
  // 在本 surface 不可用（web-only 在 extension / 反之），则回退默认主题并清空其配置，
  // 避免出现空白选择或误导性的“当前值”。
  const sourceUsable = source?.themeId
    && themeRegistry.get(source.themeId)
    && !themeRegistry.isQuarantinedSelection(source, props.surface)
  if (!sourceUsable) {
    draft.themeId = DEFAULT_THEME_ID
    draft.mode = source?.mode ?? 'auto'
    draft.config = {}
    draft.variants = {}
    draft.iconPackId = DEFAULT_ICON_PACK_ID
    return
  }
  draft.themeId = source!.themeId
  draft.mode = source?.mode ?? 'auto'
  draft.config = cloneJson((source?.config as Record<string, unknown>) ?? {})
  draft.variants = cloneJson((source?.variants as Record<string, string>) ?? {})
  draft.iconPackId = source?.iconPackId ?? DEFAULT_ICON_PACK_ID
}, { immediate: true })

/** i18n key 与字面回退：形如命名空间的键先走翻译，未命中时显示原文。 */
function resolveText(value: unknown): string {
  if (typeof value !== 'string' || !value)
    return ''
  if (/^[\w-]+(?:\.[\w-]+)+$/.test(value)) {
    const translated = t(value)
    if (translated !== value)
      return translated
  }
  return value
}

const themes = computed(() => themeRegistry.list(props.surface).map(definition => ({
  value: definition.id,
  label: resolveText(definition.meta.name),
})))

const activeDefinition = computed(() => themeRegistry.get(draft.themeId))

const visualPreview = computed(() => {
  try {
    const runtimeMode = getThemeRuntimeState().resolvedMode
    const resolvedMode = draft.mode === 'auto' ? runtimeMode : draft.mode
    const tokens = themeRegistry.resolve(buildDraftSelection(), resolvedMode).tokens
    return {
      canvas: tokens.color.pageBackground,
      surface: tokens.color.surface,
      border: tokens.color.border,
      text: tokens.color.textPrimary,
      muted: tokens.color.textMuted,
      accent: tokens.color.accent,
      radius: tokens.radius.large,
    }
  }
  catch {
    return null
  }
})

const iconPackOptions = computed(() => themeRegistry.listIconPacks().map(pack => ({
  label: pack.id === 'core.default' ? t('theme.iconPack.default') : pack.name,
  value: pack.id,
})))

const configFields = computed<Array<[string, ThemeFieldDescriptor]>>(() => {
  const fields = activeDefinition.value?.configSchema.fields ?? {}
  return Object.entries(fields)
})

const VARIANT_OPTIONS = {
  bookmark: ['glass', 'solid', 'minimal'],
  widget: ['glass', 'solid', 'borderless'],
  sidebar: ['floating', 'attached', 'minimal'],
  search: ['pill', 'box', 'underline'],
} as const

const variantGroups = computed(() =>
  (['bookmark', 'widget', 'sidebar', 'search'] as const).map(key => ({
    key,
    label: t(VARIANT_LABEL_KEYS[key]),
    options: VARIANT_OPTIONS[key],
  })),
)

function buildDraftSelection(): ThemeSelection {
  const definition = themeRegistry.get(draft.themeId)
  return {
    schemaVersion: 1,
    themeId: draft.themeId,
    themeVersion: definition?.version ?? 1,
    mode: draft.mode,
    config: draft.config,
    overrides: {},
    variants: { ...draft.variants },
    iconPackId: draft.iconPackId || undefined,
  }
}

function pushPreview() {
  // 实时预览：只影响渲染，不立即持久化。
  setThemePreview(buildDraftSelection())
  emit('preview', buildDraftSelection())
}

watch(() => draft.mode, pushPreview)

function updateConfigField(key: string, value: unknown) {
  draft.config[key] = value
  pushPreview()
}

function setVariant(key: keyof typeof VARIANT_OPTIONS, value: string) {
  draft.variants[key] = coerceVariant(key, value)
  pushPreview()
}

/** 当前 Variant 显示值：用户显式覆盖 > 主题声明默认 > 全局默认（而不是固定数组第一个）。 */
function effectiveVariant(key: keyof typeof VARIANT_OPTIONS): string {
  if (draft.variants[key])
    return draft.variants[key]
  const declared = activeDefinition.value?.variants?.[key]
  if (declared)
    return declared
  return DEFAULT_VARIANTS[key]
}

/** 清除用户在某个 Variant 上的显式覆盖，回到「跟随主题默认」。 */
function resetVariant(key: keyof typeof VARIANT_OPTIONS) {
  delete draft.variants[key]
  pushPreview()
}

/** 是否有该项的显式覆盖（用于显示「跟随默认」入口）。 */
function hasVariantOverride(key: keyof typeof VARIANT_OPTIONS): boolean {
  return Boolean(draft.variants[key])
}

function switchTheme(themeId: string) {
  const definition = themeRegistry.get(themeId)
  draft.themeId = themeId
  // 切换主题必须重置 config / Variant / iconPack 为「新主题」的默认值，
  // 不能把上一个主题的无效配置或覆盖带到新主题。
  draft.config = cloneJson(definition?.defaultConfig() ?? {})
  draft.variants = {}
  draft.iconPackId = DEFAULT_ICON_PACK_ID
  pushPreview()
}

/** 图标包切换立即触发预览，保证图标实时变化。 */
function updateIconPack(packId: string) {
  draft.iconPackId = packId
  pushPreview()
}

/**
 * 唯一的关闭出口：遮罩点击 / ESC / 右上角 X / 取消按钮全部经过这里，
 * 确保任何关闭路径都会清理预览，避免预览状态残留。
 * 保存进行中禁止关闭，避免用户在原子提交中途破坏状态。
 */
function requestClose(value: boolean) {
  if (saving.value)
    return
  setThemePreview(null)
  emit('preview', null)
  emit('update:show', value)
}

// 弹窗因任意路径关闭时兜底清理预览。
watch(() => props.show, (show) => {
  if (!show)
    setThemePreview(null)
})

async function confirmSave(forceDefault = false): Promise<void> {
  // 保存进行中禁止重复提交。
  if (saving.value)
    return
  const selection: ThemeSelection = forceDefault
    ? {
        schemaVersion: 1,
        themeId: DEFAULT_THEME_ID,
        themeVersion: themeRegistry.get(DEFAULT_THEME_ID)?.version ?? 1,
        mode: draft.mode,
        config: {},
        overrides: {},
        variants: {},
        iconPackId: undefined,
      }
    : buildDraftSelection()

  // 先校验，再原子保存。
  try {
    themeRegistry.serialize(selection)
  }
  catch (error) {
    ms.error(`${t('theme.saveRejected')}: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  saving.value = true
  try {
    // 严格出口校验一次；不论旧数据是否为隔离态，新选择的校验都不降级。
    const serialized = themeRegistry.serialize(selection)
    const result = await persistThemeSelection({
      surface: props.surface,
      serialized,
    })
    if (result.conflict) {
      // CAS 失败：保留最新本地状态，不建议从可能落后的持久化端直接重载。
      setThemePreview(null)
      emit('preview', null)
      ms.warning(t('theme.saveConflict'))
      return
    }
    if (!result.ok || result.error)
      throw result.error instanceof Error ? result.error : new Error(String(result.error ?? t('theme.saveFailed')))
    if (!result.skipped) {
      saveLastKnownGood(selection)
      emit('saved', selection)
    }
    requestClose(false)
    ms.success(t('theme.saved'))
  }
  catch (error) {
    // 保存失败：Store 未被修改（storage 层保证），清除预览即恢复原主题。
    setThemePreview(null)
    emit('preview', null)
    ms.error(`${t('theme.saveFailed')}: ${error instanceof Error ? error.message : String(error)}`)
  }
  finally {
    saving.value = false
  }
}

const runtimeState = getThemeRuntimeState()
/** 隔离提示：当前主题数据无法识别时在弹窗顶部明示。 */
const quarantinedNotice = computed(() => runtimeState.quarantined && !getThemePreview())

async function restoreDefaultTheme() {
  draft.themeId = DEFAULT_THEME_ID
  draft.config = {}
  draft.variants = {}
  await confirmSave(true)
}

defineExpose({ confirmSave })
</script>

<script lang="ts">
function parseDateInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

function formatDateInput(timestamp: number | null): string {
  if (timestamp === null)
    return ''
  const date = new Date(timestamp)
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
</script>

<template>
  <NModal
    :show="props.show"
    :to="props.surface === 'extension' ? '.pn-theme-root' : undefined"
    preset="card"
    class="theme-settings-modal"
    :title="t('theme.center.title')"
    :style="{ maxWidth: '640px', width: '92vw' }"
    @update:show="requestClose"
  >
    <div class="theme-settings-body">
      <NAlert v-if="quarantinedNotice" type="warning" :show-icon="true" class="mb-3">
        {{ t('theme.quarantinedNotice') }}
      </NAlert>
      <section class="theme-section">
        <h4>{{ t('theme.center.themes') }}</h4>
        <NSelect :value="draft.themeId" :options="themes" @update:value="switchTheme" />
        <div
          v-if="visualPreview"
          class="theme-visual-preview"
          :style="{ background: visualPreview.canvas, color: visualPreview.text, borderColor: visualPreview.border, borderRadius: visualPreview.radius }"
          aria-label="主题实时预览"
        >
          <div class="theme-preview-sidebar" :style="{ background: visualPreview.surface, borderColor: visualPreview.border }">
            <i :style="{ background: visualPreview.accent }" /><i /><i />
          </div>
          <div class="theme-preview-content">
            <strong>Panel Next</strong>
            <span :style="{ color: visualPreview.muted }">{{ resolveText(activeDefinition?.meta.description) || t('theme.default.description') }}</span>
            <div class="theme-preview-cards">
              <i :style="{ background: visualPreview.surface, borderColor: visualPreview.border }" /><i :style="{ background: visualPreview.surface, borderColor: visualPreview.border }" />
            </div>
          </div>
        </div>
        <p v-if="activeDefinition?.meta.description" class="theme-meta-line">
          {{ resolveText(activeDefinition.meta.description) }}
        </p>
        <p class="theme-meta-line theme-meta-muted">
          <span v-if="activeDefinition?.meta.author">{{ t('theme.meta.author') }}: {{ activeDefinition.meta.author }}</span>
          <span>v{{ activeDefinition?.version ?? 1 }}</span>
          <span>{{ t(`theme.surface.${props.surface}`) }}</span>
        </p>
      </section>

      <section class="theme-section">
        <h4>{{ t('theme.mode.title') }}</h4>
        <NRadioGroup v-model:value="draft.mode" name="theme-mode">
          <NRadioButton value="light">
            {{ t('theme.mode.light') }}
          </NRadioButton>
          <NRadioButton value="dark">
            {{ t('theme.mode.dark') }}
          </NRadioButton>
          <NRadioButton value="auto">
            {{ t('theme.mode.auto') }}
          </NRadioButton>
        </NRadioGroup>
      </section>

      <section v-if="configFields.length" class="theme-section">
        <h4>{{ t('theme.center.config') }}</h4>
        <div v-for="[key, descriptor] in configFields" :key="key" class="theme-config-block">
          <div class="theme-config-label">
            <label>{{ resolveText(descriptor.label) || key }}</label>
            <p v-if="descriptor.description" class="theme-config-description">
              {{ resolveText(descriptor.description) }}
            </p>
          </div>
          <NSwitch
            v-if="descriptor.kind === 'boolean'"
            :value="Boolean(draft.config[key] ?? descriptor.defaultValue)"
            @update:value="(value: boolean) => updateConfigField(key, value)"
          />
          <NSelect
            v-else-if="descriptor.kind === 'enum'"
            :value="String(draft.config[key] ?? descriptor.defaultValue ?? '')"
            :options="(descriptor.values ?? []).map(v => ({ label: v, value: v }))"
            @update:value="(value: string) => updateConfigField(key, value)"
          />
          <NInputNumber
            v-else-if="descriptor.kind === 'integer' || descriptor.kind === 'number'"
            :value="Number(draft.config[key] ?? descriptor.defaultValue ?? 0)"
            :min="descriptor.minimum"
            :max="descriptor.maximum"
            :precision="descriptor.kind === 'integer' ? 0 : undefined"
            @update:value="(value: number | null) => updateConfigField(key, value ?? 0)"
          />
          <NColorPicker
            v-else-if="descriptor.kind === 'color'"
            :value="String(draft.config[key] ?? descriptor.defaultValue ?? '#000000')"
            :show-alpha="true"
            @update:value="(value: string) => updateConfigField(key, value)"
          />
          <NDatePicker
            v-else-if="descriptor.kind === 'date'"
            :value="parseDateInput(String(draft.config[key] ?? descriptor.defaultValue ?? ''))"
            type="date"
            @update:value="(value: number | null) => updateConfigField(key, formatDateInput(value))"
          />
          <NInput
            v-else
            :value="String(draft.config[key] ?? descriptor.defaultValue ?? '')"
            clearable
            @update:value="(value: string) => updateConfigField(key, value)"
          />
        </div>
      </section>

      <section class="theme-section">
        <h4>{{ t('theme.variants.title') }}</h4>
        <div v-for="group in variantGroups" :key="group.key" class="theme-config-row">
          <label>{{ group.label }}</label>
          <NSelect
            :value="effectiveVariant(group.key)"
            :options="group.options.map(option => ({ label: t(`theme.variant.${option}`), value: option }))"
            @update:value="(value: string) => setVariant(group.key, value)"
          />
          <NButton
            v-if="hasVariantOverride(group.key)"
            size="tiny"
            text
            type="warning"
            @click="resetVariant(group.key)"
          >
            {{ t('theme.variants.followDefault') }}
          </NButton>
        </div>
      </section>

      <section class="theme-section">
        <h4>{{ t('theme.iconPack.title') }}</h4>
        <NSelect
          :value="draft.iconPackId"
          :options="iconPackOptions"
          @update:value="updateIconPack"
        />
      </section>
    </div>

    <template #footer>
      <div class="theme-settings-footer">
        <NButton quaternary :disabled="saving" @click="restoreDefaultTheme">
          {{ t('theme.restoreDefault') }}
        </NButton>
        <div class="footer-actions">
          <NButton quaternary :disabled="saving" @click="requestClose(false)">
            {{ t('common.cancel') }}
          </NButton>
          <NButton type="primary" :loading="saving" @click="confirmSave()">
            {{ t('common.save') }}
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
:global(.theme-settings-modal.n-card) {
  border: 1px solid var(--pn-modal-border, var(--pn-color-border, rgba(148, 163, 184, .24)));
  border-radius: var(--pn-radius-large, 18px);
  color: var(--pn-modal-content-text-color, var(--pn-color-text-secondary, inherit));
  background: var(--pn-modal-background, var(--pn-color-surface, #fff));
  box-shadow: var(--pn-effect-shadow-high, 0 22px 60px rgba(2, 6, 23, .3));
}
:global(.theme-settings-modal .n-card-header) {
  color: var(--pn-modal-title-text-color, var(--pn-color-text-primary, inherit));
  border-bottom: 1px solid var(--pn-modal-border, var(--pn-color-border, transparent));
}
:global(.theme-settings-modal .n-card__footer) {
  border-top: 1px solid var(--pn-modal-border, var(--pn-color-border, transparent));
}
.theme-settings-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-height: min(60vh, 520px);
  overflow-y: auto;
}

.theme-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  opacity: 0.85;
}

.theme-visual-preview {
  height: 116px;
  margin-top: 10px;
  padding: 10px;
  display: flex;
  gap: 10px;
  overflow: hidden;
  border: 1px solid;
}
.theme-preview-sidebar { width: 34px; padding: 7px; display: flex; flex-direction: column; gap: 7px; border: 1px solid; border-radius: 10px; }
.theme-preview-sidebar i { width: 18px; height: 18px; display: block; border-radius: 6px; background: currentColor; opacity: .2; }
.theme-preview-sidebar i:first-child { opacity: 1; }
.theme-preview-content { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 5px; }
.theme-preview-content strong { font-size: 13px; }
.theme-preview-content > span { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.theme-preview-cards { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.theme-preview-cards i { height: 48px; border: 1px solid; border-radius: 10px; }

.theme-meta-line {
  display: flex;
  gap: 12px;
  margin: 8px 0 0;
  font-size: 12px;
  opacity: 0.75;
}

.theme-config-row {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.theme-config-row label {
  font-size: 13px;
  opacity: 0.85;
}

/* 配置项：label 与 description 上下排列，控件居右。 */
.theme-config-block {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) 1fr;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.theme-config-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.theme-config-label label {
  font-size: 13px;
  opacity: 0.9;
}

.theme-config-description {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  opacity: 0.6;
  word-break: break-word;
}

.theme-settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.footer-actions {
  display: flex;
  gap: 10px;
}
</style>
