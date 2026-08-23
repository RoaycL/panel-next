export type {
  BookmarkVariant,
  DeepPartial,
  ResolvedTheme,
  ResolvedThemeMode,
  SearchVariant,
  SidebarVariant,
  ThemeColorTokens,
  ThemeConfigSchema,
  ThemeContext,
  ThemeDefinition,
  ThemeEffectTokens,
  ThemeFieldDescriptor,
  ThemeIconName,
  ThemeIconSet,
  ThemeLoadIssue,
  ThemeLoadResult,
  ThemeMeta,
  ThemeMigration,
  ThemeMode,
  ThemeNotificationTokens,
  ThemeSelection,
  ThemeSurface,
  ThemeTokenOverrides,
  ThemeTokens,
  ThemeVariants,
  ThemeVariantOverrides,
  WidgetVariant,
} from './types'

export {
  DEFAULT_ICON_PACK_ID,
  DEFAULT_THEME_ID,
  RESERVED_ICON_PACK_PREFIX,
  THEME_ID_PATTERN,
} from './constants'
export {
  RESERVED_THEME_ID_PREFIX,
  THEME_ICON_NAMES,
  THEME_SELECTION_SCHEMA_VERSION,
} from './types'
export { themeRegistry, ThemeRegistry } from './registry'
export { defineTheme } from './defineTheme'
export { validateThemeWireSelection, validateVariantOverrides, jsonSize } from './schema'
export { createDefaultSelection, ensureThemeSelection, needsThemeSelection, preparePanelAppearance, selectionFromLegacy, stripInvalidTheme } from './legacyAdapter'
export type { PanelAppearanceResult } from './legacyAdapter'
export { useTheme, useWidgetTheme, THEME_CONTEXT_KEY, defaultThemeContextValue } from './context'
export type { ThemeContextValue, WidgetThemeValue } from './context'
export { resolveThemeMode, setThemePreview, setPreferredDark, getPreferredDark, getThemeRuntimeState } from './runtime'
export { createThemeContextValue } from './context'
export { persistThemeSelection, registerThemeStoreAccessor, saveLastKnownGood, getLastKnownGood } from './storage'
export type { ThemePersistRequest, ThemePersistResult } from './storage'
export {
  computePackageDigest,
  isSafeAssetPath,
  validateImportedSelection,
  validateThemePackage,
  themePackageToDefinition,
} from './themePackage'
export type { ThemePackageManifestV1 } from './themePackage'
export { tokensToCssVariables, ThemeValueError } from './cssVariables'
export { cloneJson } from './clone'
export { DEFAULT_VARIANTS, coerceVariant, resolveVariantCssVariables, VARIANT_LABEL_KEYS } from './variants'
export { DEFAULT_ICON_SET, completeIconSet } from './icons'
