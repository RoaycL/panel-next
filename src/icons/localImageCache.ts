const CACHE_NAME = 'panel-next-bookmark-images-v1'
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 6000

export interface LocalIconImage {
  url: string
  persisted: boolean
}

const ready = new Map<string, LocalIconImage>()
const pending = new Map<string, Promise<LocalIconImage | null>>()

function isHttpImageSource(source: string): boolean {
  try {
    const url = new URL(source)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

function usableImage(blob: Blob): boolean {
  return blob.size > 0 && blob.size <= MAX_IMAGE_BYTES && blob.type.toLowerCase().startsWith('image/')
}

async function readBoundedImage(response: Response, contentType: string): Promise<Blob | null> {
  if (!response.body) {
    const blob = await response.blob()
    return usableImage(blob) ? blob : null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(new Uint8Array(value))
    }
  }
  finally {
    reader.releaseLock()
  }
  const blob = new Blob(chunks, { type: contentType })
  return usableImage(blob) ? blob : null
}

function remember(source: string, blob: Blob, persisted: boolean): LocalIconImage {
  const previous = ready.get(source)
  if (previous?.url.startsWith('blob:'))
    URL.revokeObjectURL(previous.url)
  const result = { url: URL.createObjectURL(blob), persisted }
  ready.set(source, result)
  return result
}

async function loadImage(source: string, refresh: boolean): Promise<LocalIconImage | null> {
  if (!isHttpImageSource(source) || typeof caches === 'undefined' || typeof URL.createObjectURL !== 'function')
    return null

  let cache: Cache
  try {
    cache = await caches.open(CACHE_NAME)
    if (!refresh) {
      const stored = await cache.match(source)
      if (stored) {
        const blob = await stored.blob()
        if (usableImage(blob))
          return remember(source, blob, true)
        await cache.delete(source)
      }
    }
  }
  catch {
    return null
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(source, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (!response.ok || !contentType.startsWith('image/') || contentLength > MAX_IMAGE_BYTES)
      return null
    const blob = await readBoundedImage(response, contentType)
    if (!blob)
      return null
    try {
      await cache.put(source, new Response(blob, { headers: { 'Content-Type': blob.type } }))
      return remember(source, blob, true)
    }
    catch {
      // A full or disabled browser cache should not hide a successfully fetched icon.
      return remember(source, blob, false)
    }
  }
  catch {
    return null
  }
  finally {
    clearTimeout(timeout)
  }
}

/** Reads persistent browser storage first; network is used only for a cache miss or an explicit refresh. */
export function getLocalIconImage(source: string, refresh = false): Promise<LocalIconImage | null> {
  if (!refresh && ready.has(source))
    return Promise.resolve(ready.get(source)!)
  if (pending.has(source))
    return pending.get(source)!
  const task = loadImage(source, refresh).finally(() => pending.delete(source))
  pending.set(source, task)
  return task
}

export async function cacheSavedIconImage(source: string): Promise<boolean> {
  return Boolean((await getLocalIconImage(source))?.persisted)
}
