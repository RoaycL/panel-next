import type { StorageAdapter } from './types'
import { notifySettingsChanged } from './settingsEvents'

export interface FavoriteWallpaper {
  url: string
  thumbnail: string
  title: string
  source: 'private' | 'public' | 'imgbed' | 'wallhaven' | 'bing' | 'konachan' | 'yandere'
  savedAt: string
}

export const MAX_WALLPAPER_FAVORITES = 200
const FAVORITE_SOURCES: FavoriteWallpaper['source'][] = ['private', 'public', 'imgbed', 'wallhaven', 'bing', 'konachan', 'yandere']

export function wallpaperFavoritesKey(origin: string | null, accountId?: number): string {
  return `PANEL_NEXT_WALLPAPER_FAVORITES_V1:${encodeURIComponent(origin || 'local')}:${accountId ?? 'guest'}`
}

function safeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2048) return false
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  }
  catch { return false }
}

export function wallpaperIdentity(url: string, origin: string | null): string {
  try { return new URL(url, origin || 'https://local.invalid').href }
  catch { return url }
}

export function readWallpaperFavorites(storage: StorageAdapter, key: string, origin: string | null): FavoriteWallpaper[] {
  try {
    const saved: unknown = JSON.parse(storage.getItem(key) || '[]')
    if (!Array.isArray(saved)) return []
    const seen = new Set<string>()
    return saved.filter((item): item is FavoriteWallpaper => {
      if (!item || !safeImageUrl(item.url) || !safeImageUrl(item.thumbnail)
        || typeof item.title !== 'string' || item.title.length > 160
        || !FAVORITE_SOURCES.includes(item.source)
        || typeof item.savedAt !== 'string' || !Number.isFinite(Date.parse(item.savedAt))) return false
      const id = wallpaperIdentity(item.url, origin)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    }).slice(0, MAX_WALLPAPER_FAVORITES)
  }
  catch { return [] }
}

/** Await extension persistence before showing success; restore the old value on failure. */
export async function writeWallpaperFavorites(storage: StorageAdapter, key: string, favorites: FavoriteWallpaper[]): Promise<void> {
  const old = storage.getItem(key)
  try {
    storage.setItem(key, JSON.stringify(favorites))
    await storage.flush?.()
    notifySettingsChanged()
  }
  catch (error) {
    try {
      if (old === null) storage.removeItem(key)
      else storage.setItem(key, old)
      await storage.flush?.()
    }
    catch { /* Report the original persistence failure. */ }
    throw error
  }
}
