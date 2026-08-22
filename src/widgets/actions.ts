import { createDiscreteApi } from 'naive-ui'
import type { DiscreteApi } from 'naive-ui'
import { getRuntime } from '@/runtime'
import { t } from '@/locales'
import { assertContextCapability } from './capabilities'
import { useWidgetContext } from './context'

/**
 * 宿主动作封装：通知、确认框、打开链接、复制、下载、定位。
 *
 * 全部经由宿主运行时适配层（导航统一走 runtime.openUrl）；
 * clipboard / geolocation 需要对应能力声明，未授权时抛出 WidgetPermissionError。
 */
export interface WidgetNotifyOptions {
  type?: 'success' | 'warning' | 'error' | 'info'
  durationMs?: number
}

export interface WidgetConfirmOptions {
  title?: string
  positiveText?: string
  negativeText?: string
}

export interface WidgetPositionOptions {
  timeoutMs?: number
  enableHighAccuracy?: boolean
}

let discrete: DiscreteApi<'message' | 'dialog'> | null = null

function getDiscrete(): DiscreteApi<'message' | 'dialog'> {
  if (!discrete)
    discrete = createDiscreteApi(['message', 'dialog'])
  return discrete
}

function safeExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.href)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  }
  catch {
    return null
  }
}

export function useWidgetActions() {
  const context = useWidgetContext()

  /** 轻提示；不需要能力声明。 */
  function notify(message: string, options: WidgetNotifyOptions = {}) {
    const { message: messageApi } = getDiscrete()
    messageApi[options.type ?? 'info'](message, { duration: options.durationMs ?? 2500 })
  }

  /** 确认框，resolve true 表示用户确认；不需要能力声明。 */
  function confirm(content: string, options?: string | WidgetConfirmOptions): Promise<boolean> {
    const { dialog } = getDiscrete()
    const opts: WidgetConfirmOptions = typeof options === 'string' ? { title: options } : (options ?? {})
    const titleKey = t('widgetActions.confirmTitle')
    const confirmKey = t('common.confirm')
    const cancelKey = t('common.cancel')
    const defTitle = titleKey && titleKey !== 'widgetActions.confirmTitle' ? titleKey : '确认操作'
    const defPositive = confirmKey && confirmKey !== 'common.confirm' ? confirmKey : '确定'
    const defNegative = cancelKey && cancelKey !== 'common.cancel' ? cancelKey : '取消'

    return new Promise((resolve) => {
      dialog.warning({
        title: opts.title ?? defTitle,
        content,
        positiveText: opts.positiveText ?? defPositive,
        negativeText: opts.negativeText ?? defNegative,
        onPositiveClick: () => resolve(true),
        onNegativeClick: () => resolve(false),
        onClose: () => resolve(false),
        onMaskClick: () => resolve(false),
      })
    })
  }

  /** 打开外链：http(s) 校验 + 运行时导航（Web 新标签 / 扩展标签页）。 */
  function openLink(url: string, mode: 'tab' | 'current' = 'tab') {
    const target = safeExternalUrl(url)
    if (!target)
      throw new Error(`Blocked unsafe widget link: ${url}`)
    getRuntime().openUrl(target, mode)
  }

  async function copy(text: string): Promise<void> {
    assertContextCapability(context, 'clipboard')
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
    // 降级：隐藏 textarea + execCommand（非安全上下文）
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      if (!document.execCommand('copy'))
        throw new Error('Clipboard copy was rejected.')
    }
    finally {
      textarea.remove()
    }
  }

  function download(filename: string, source: Blob | string): void {
    const anchor = document.createElement('a')
    if (typeof source === 'string') {
      const href = safeExternalUrl(source)
      if (!href)
        throw new Error(`Blocked unsafe download URL: ${source}`)
      anchor.href = href
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
    }
    else {
      anchor.href = URL.createObjectURL(source)
    }
    anchor.download = filename.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'download'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    if (typeof source !== 'string')
      setTimeout(() => URL.revokeObjectURL(anchor.href), 30_000)
  }

  function getPosition(options: WidgetPositionOptions = {}): Promise<GeolocationPosition> {
    assertContextCapability(context, 'geolocation')
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is unavailable in this environment.'))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: options.timeoutMs ?? 10_000,
        enableHighAccuracy: options.enableHighAccuracy ?? false,
        maximumAge: 5 * 60_000,
      })
    })
  }

  return { notify, confirm, openLink, copy, download, getPosition }
}
