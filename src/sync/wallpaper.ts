/** Only these fields are shared; extension themes/layout remain device-local. */
export const WALLPAPER_FIELDS = ['backgroundImageSrc', 'backgroundBlur', 'backgroundMaskNumber'] as const
export type Wallpaper = Required<Pick<Panel.panelConfig, typeof WALLPAPER_FIELDS[number]>>
export interface WallpaperMutation {
  wallpaper: Wallpaper
  wallpaperBase?: Wallpaper
}

export function pickWallpaper(config: Partial<Panel.panelConfig>): Wallpaper {
  return {
    backgroundImageSrc: config.backgroundImageSrc ?? '',
    backgroundBlur: config.backgroundBlur ?? 0,
    backgroundMaskNumber: config.backgroundMaskNumber ?? 0,
  }
}

export function isWallpaperMutation(payload: unknown): payload is WallpaperMutation {
  if (!payload || typeof payload !== 'object' || !('wallpaper' in payload))
    return false
  const value = payload.wallpaper
  return Boolean(value && typeof value === 'object'
    && 'backgroundImageSrc' in value && typeof value.backgroundImageSrc === 'string'
    && 'backgroundBlur' in value && typeof value.backgroundBlur === 'number' && Number.isFinite(value.backgroundBlur)
    && 'backgroundMaskNumber' in value && typeof value.backgroundMaskNumber === 'number' && Number.isFinite(value.backgroundMaskNumber))
}

export function mergeWallpaper(config: Panel.panelConfig, wallpaper: Wallpaper): Panel.panelConfig {
  return { ...config, ...pickWallpaper(wallpaper) }
}
