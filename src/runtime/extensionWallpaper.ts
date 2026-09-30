import { getBootstrap } from '@/api/sync'
import { mutationPost } from '@/api/panel/mutation'
import { useAuthStore } from '@/store/modules/auth'
import { readBootstrapSnapshot } from '@/sync/bootstrapCache'
import { enqueueOfflineMutation, readOfflineQueue } from '@/sync/offlineQueue'
import { getSyncRevision, setSyncRevision } from '@/sync/revision'
import { isSyncRevision } from '@/sync/bootstrapSnapshot'
import { isWallpaperMutation, mergeWallpaper, pickWallpaper } from '@/sync/wallpaper'
import type { Wallpaper } from '@/sync/wallpaper'
import { HttpRequestError } from '@/utils/request'
import { getRuntime } from './index'
import { saveExtensionAppearance } from './extensionAppearance'

const WALLPAPER_SYNC_KEY = 'PANEL_NEXT_WALLPAPER_SYNC_V1'
interface WallpaperReceipt { accountId: number; revision: Sync.Revision; wallpaper: Wallpaper }
export interface WallpaperSaveResult { status: 'local' | 'synced' | 'queued' | 'failed'; message?: string }

/** Never let an old cached bootstrap undo a just-accepted wallpaper save. */
export function resolveSyncedWallpaper(local: Panel.panelConfig, remote: Panel.panelConfig, revision: Sync.Revision, accountId: number): Panel.panelConfig {
  const queued = readOfflineQueue(accountId).filter(item => item.action === 'panel.set' && item.status !== 'applied' && isWallpaperMutation(item.payload)).at(-1)
  if (queued && isWallpaperMutation(queued.payload))
    return mergeWallpaper(local, queued.payload.wallpaper)
  try {
    const receipt = JSON.parse(getRuntime().storage.getItem(WALLPAPER_SYNC_KEY) || 'null') as WallpaperReceipt | null
    if (receipt?.accountId === accountId && isSyncRevision(receipt.revision) && BigInt(receipt.revision) > BigInt(revision) && isWallpaperMutation(receipt))
      return mergeWallpaper(local, receipt.wallpaper)
  }
  catch { /* Invalid receipts cannot block fresh cloud state. */ }
  // An absent wallpaper field on legacy servers is not an explicit removal.
  return Object.hasOwn(remote, 'backgroundImageSrc') ? mergeWallpaper(local, pickWallpaper(remote)) : local
}

export async function saveAndSyncExtensionWallpaper(config: Panel.panelConfig): Promise<WallpaperSaveResult> {
  await saveExtensionAppearance(config)
  const auth = useAuthStore()
  const accountId = auth.userInfo?.id
  if (!auth.token || !accountId)
    return { status: 'local' }
  const origin = getRuntime().getServerOrigin()
  const wallpaper = pickWallpaper(config)
  let baseline = readBootstrapSnapshot(accountId)?.data ?? null
  const queue = async (): Promise<WallpaperSaveResult> => {
    if (!auth.token || auth.userInfo?.id !== accountId || getRuntime().getServerOrigin() !== origin)
      return { status: 'failed', message: '账号或服务器已切换，请重新选择壁纸' }
    await enqueueOfflineMutation(accountId, {
      action: 'panel.set', resourceType: 'panel', baseRevision: baseline?.revision ?? null,
      payload: { wallpaper, wallpaperBase: baseline ? pickWallpaper(baseline.panel.config) : undefined },
    }, origin ?? undefined)
    return { status: 'queued' }
  }
  try {
    // Preserve the order of offline intent instead of sending a newer change
    // ahead of an older queued wallpaper that could later overwrite it.
    if (readOfflineQueue(accountId).some(item => item.action === 'panel.set' && item.status !== 'applied' && isWallpaperMutation(item.payload)))
      return await queue()
    const response = await getBootstrap()
    if (auth.userInfo?.id !== accountId || !auth.token || getRuntime().getServerOrigin() !== origin)
      return { status: 'failed', message: '账号或服务器已切换，请在当前账号重新选择壁纸' }
    if (response.code !== 0 || !response.data || response.data.account.id !== accountId)
      return { status: 'failed', message: response.msg || '无法读取云端壁纸设置' }
    baseline = response.data
    setSyncRevision(baseline.revision)
    const result = await mutationPost('/panel/userConfig/set', { panel: mergeWallpaper(baseline.panel.config, wallpaper) }, {
      queuePayload: { wallpaper, wallpaperBase: pickWallpaper(baseline.panel.config) },
    })
    if (result.code !== 0)
      return { status: 'failed', message: result.msg || '云端未接受壁纸修改' }
    if (result.queued)
      return { status: 'queued', message: result.conflict ? '云端壁纸发生变化，等待冲突处理' : undefined }
    if (!auth.token || auth.userInfo?.id !== accountId || getRuntime().getServerOrigin() !== origin)
      return { status: 'failed', message: '壁纸已提交，但账号或服务器已切换，请刷新当前页面' }
    getRuntime().storage.setItem(WALLPAPER_SYNC_KEY, JSON.stringify({ accountId, revision: getSyncRevision(), wallpaper }))
    await getRuntime().storage.flush?.()
    return { status: 'synced' }
  }
  catch (error) {
    if (error instanceof HttpRequestError && error.retryable && auth.userInfo?.id === accountId && auth.token && getRuntime().getServerOrigin() === origin) {
      try { return await queue() }
      catch { return { status: 'failed', message: '壁纸已保存在本机，但待同步队列保存失败，请重试' } }
    }
    return { status: 'failed', message: error instanceof Error ? error.message : '壁纸已保存在本机，但云端同步失败' }
  }
}
