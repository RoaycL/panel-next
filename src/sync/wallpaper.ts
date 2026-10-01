import { validateThemeWallpaperMap } from '@/themes/schema'

/** Wallpaper pairs are shared; theme selection, palette and layout remain device-local. */
export const WALLPAPER_FIELDS = ['backgroundImageSrc', 'backgroundBlur', 'backgroundMaskNumber'] as const
export type Wallpaper = Required<Pick<Panel.panelConfig, typeof WALLPAPER_FIELDS[number]>> & { themeWallpapers?: NonNullable<Panel.panelConfig['theme']>['wallpapers'] }
export interface WallpaperMutation {
  wallpaper: Wallpaper
  wallpaperBase?: Wallpaper
}

export function pickWallpaper(config: Partial<Panel.panelConfig> & Pick<Wallpaper, 'themeWallpapers'>): Wallpaper {
  const themeWallpapers = config.theme?.wallpapers ?? config.themeWallpapers
  return {
    backgroundImageSrc: config.backgroundImageSrc ?? '',
    backgroundBlur: config.backgroundBlur ?? 0,
    backgroundMaskNumber: config.backgroundMaskNumber ?? 0,
    ...(themeWallpapers ? { themeWallpapers: JSON.parse(JSON.stringify(themeWallpapers)) } : {}),
  }
}

export function isWallpaperMutation(payload: unknown): payload is WallpaperMutation {
  if (!payload || typeof payload !== 'object' || !('wallpaper' in payload))
    return false
  const value = payload.wallpaper
  if (value && typeof value === 'object' && 'themeWallpapers' in value && validateThemeWallpaperMap(value.themeWallpapers)) return false
  return Boolean(value && typeof value === 'object'
    && 'backgroundImageSrc' in value && typeof value.backgroundImageSrc === 'string'
    && 'backgroundBlur' in value && typeof value.backgroundBlur === 'number' && Number.isFinite(value.backgroundBlur)
    && 'backgroundMaskNumber' in value && typeof value.backgroundMaskNumber === 'number' && Number.isFinite(value.backgroundMaskNumber))
}

export function mergeWallpaper(config: Panel.panelConfig, wallpaper: Wallpaper): Panel.panelConfig {
  const { themeWallpapers: _ignored, ...fields } = pickWallpaper(wallpaper)
  const result = { ...config, ...fields }
  if (wallpaper.themeWallpapers) {
    result.theme = {
      ...(config.theme ?? { schemaVersion: 1, themeId: 'core.default', themeVersion: 1, mode: 'auto' }),
      wallpapers: JSON.parse(JSON.stringify(wallpaper.themeWallpapers)),
    }
  }
  return result
}
