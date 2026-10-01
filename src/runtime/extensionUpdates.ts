import { computed, ref } from 'vue'
import { getExtensionUpdateBridge } from './extension'

interface UpdateState {
  currentVersion?: string
  latest?: { version: string; releaseUrl: string; downloadUrl: string } | null
  checkedAt?: number
  dismissedVersion?: string
  error?: string
}
export const extensionUpdateState = ref<UpdateState>({})
export const extensionUpdateChecking = ref(false)
export const extensionUpdateAvailable = computed(() => {
  const state = extensionUpdateState.value
  return !!state.latest && state.latest.version !== state.dismissedVersion
})
let initialized = false
let pending: Promise<void> | null = null

export function checkExtensionUpdate(): Promise<void> {
  if (pending) return pending
  const bridge = getExtensionUpdateBridge()
  if (!bridge) return Promise.resolve()
  extensionUpdateChecking.value = true
  pending = bridge.check().then((state) => {
    if (state) extensionUpdateState.value = state as UpdateState
  }).catch(() => {
    extensionUpdateState.value = { ...extensionUpdateState.value, error: '更新检查暂不可用，请重新加载扩展后重试' }
  }).finally(() => { extensionUpdateChecking.value = false; pending = null })
  return pending
}

export function initializeExtensionUpdates() {
  const bridge = getExtensionUpdateBridge()
  if (initialized || !bridge) return
  initialized = true
  bridge.subscribe((state) => { extensionUpdateState.value = (state as UpdateState) || {} })
  void bridge.read().then((state) => {
    extensionUpdateState.value = (state as UpdateState) || {}
    return checkExtensionUpdate()
  }).catch(() => { void checkExtensionUpdate() })
}

export async function dismissExtensionUpdate() {
  const next = { ...extensionUpdateState.value, dismissedVersion: extensionUpdateState.value.latest?.version }
  await getExtensionUpdateBridge()?.write(next)
  extensionUpdateState.value = next
}
