import type { ResolvedThemeMode, ThemeDefinition, ThemeSelection } from './types'

/** Missing dark wallpaper shares light; missing both retains the pre-theme wallpaper. */
export function resolveThemeWallpaper(selection: Readonly<ThemeSelection> | null | undefined, definition: ThemeDefinition | undefined, mode: ResolvedThemeMode, legacy = ''): string {
  const pair = selection?.wallpapers?.[selection.themeId]
  return pair?.[mode] ?? pair?.light ?? definition?.wallpapers?.[mode] ?? definition?.wallpapers?.light ?? legacy
}

export function withThemeWallpaper(selection: ThemeSelection, mode: ResolvedThemeMode, url: string, shared = false): ThemeSelection {
  return { ...selection, wallpapers: { ...selection.wallpapers, [selection.themeId]: {
    ...selection.wallpapers?.[selection.themeId], ...(shared ? { light: url, dark: url } : { [mode]: url }),
  } } }
}
