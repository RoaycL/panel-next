import { onBeforeUnmount, ref, watch } from 'vue'
import type { Ref } from 'vue'

export function preloadWallpaper(url: string, timeoutMs = 20000): Promise<void> {
  if (!url) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const image = new Image()
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error) => {
      clearTimeout(timer)
      image.onload = image.onerror = null
      if (error) { image.src = ''; reject(error) }
      else resolve()
    }
    timer = setTimeout(() => finish(new Error('壁纸加载超时，请检查网络后重试')), timeoutMs)
    image.onload = () => finish()
    image.onerror = () => finish(new Error('壁纸加载失败，可能是地址失效、网络或图片访问权限问题'))
    image.src = url
  })
}

/** Commit only the latest successfully loaded image; preserve the old image on failure. */
export function useLoadedWallpaper(source: Readonly<Ref<string>>) {
  const displayed = ref('')
  const error = ref('')
  let generation = 0
  // The last URL that actually loaded; an optimistic paint is never a fallback.
  let loaded = ''
  watch(source, async url => {
    const current = ++generation
    error.value = ''
    if (!url) { displayed.value = ''; return }
    // With nothing on screen there is no old image to keep, so waiting for the
    // preload would only show a blank page. Let the browser paint from cache.
    if (!displayed.value) displayed.value = url
    try {
      await preloadWallpaper(url)
      if (current === generation) { loaded = url; displayed.value = url }
    }
    catch (failure) {
      if (current === generation) {
        displayed.value = loaded
        error.value = failure instanceof Error ? failure.message : '壁纸加载失败'
      }
    }
  }, { immediate: true })
  onBeforeUnmount(() => { generation++ })
  return { displayed, error }
}
