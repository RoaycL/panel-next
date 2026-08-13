import type { OpenUrlMode } from './types'
import { getRuntime } from './index'

function findAnchor(event: MouseEvent) {
  return event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null
}

/** Routes rendered and user-configured anchor links through RuntimeAdapter. */
export function handleRuntimeLink(event: MouseEvent) {
  const anchor = findAnchor(event)
  if (!anchor || anchor.hasAttribute('download'))
    return
  const rawHref = anchor.getAttribute('href')?.trim()
  if (!rawHref || rawHref.startsWith('#'))
    return

  let target: URL
  try {
    target = new URL(rawHref, window.location.href)
  }
  catch {
    event.preventDefault()
    return
  }
  const external = target.origin !== window.location.origin
  const requestedTab = anchor.target === '_blank' || event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey
  if (!external && !requestedTab)
    return

  event.preventDefault()
  const mode: OpenUrlMode = requestedTab ? 'tab' : 'current'
  try {
    getRuntime().openUrl(target.href, mode)
  }
  catch (error) {
    console.warn('Blocked unsafe navigation.', error)
  }
}
