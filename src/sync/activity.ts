import { computed, ref } from 'vue'

const activeTasks = ref(0)

/** Shown in the top-right sync indicator; empty when the last sync worked. */
export const syncFailureMessage = ref('')
export const isSyncActive = computed(() => activeTasks.value > 0)

/** Starts a background sync step; call the returned function once it ends. */
export function beginSyncActivity() {
  let ended = false
  activeTasks.value++
  return () => {
    if (ended) return
    ended = true
    activeTasks.value--
  }
}

/** Marks a background sync step so the indicator can animate while it runs. */
export async function trackSyncActivity<T>(task: () => Promise<T>): Promise<T> {
  const end = beginSyncActivity()
  try {
    return await task()
  }
  finally {
    end()
  }
}

export function reportSyncFailure(message: string) {
  syncFailureMessage.value = message
}

export function clearSyncFailure() {
  syncFailureMessage.value = ''
}
