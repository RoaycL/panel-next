import { onUnmounted, ref, shallowRef, watch } from 'vue'
import { useWidgetStorage } from '../context'

type SaveStatus = 'saved' | 'saving' | 'error'

/** Persist a widget's interactive content in its isolated local storage space. */
export function useStoredWidgetValue<T>(key: string, fallback: T, validate: (value: unknown) => value is T) {
  const storage = useWidgetStorage()
  const stored = storage.read<T>(key)
  const value = shallowRef<T>(validate(stored) ? stored : fallback)
  const status = ref<SaveStatus>('saved')
  let timer: ReturnType<typeof setTimeout> | null = null
  let generation = 0

  async function saveNow() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const currentGeneration = generation
    const snapshot = value.value
    status.value = 'saving'
    const saved = await storage.write(key, snapshot)
    if (currentGeneration === generation)
      status.value = saved ? 'saved' : 'error'
  }

  watch(value, () => {
    generation += 1
    status.value = 'saving'
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(() => { void saveNow() }, 350)
  }, { flush: 'sync' })

  function flushPending() {
    if (timer)
      void saveNow()
  }

  window.addEventListener('pagehide', flushPending)
  onUnmounted(() => {
    window.removeEventListener('pagehide', flushPending)
    flushPending()
  })

  return { value, status, saveNow }
}
