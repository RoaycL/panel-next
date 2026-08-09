import type { RuntimeAdapter } from './types'
import { createExtensionRuntime } from './extension'
import { createWebRuntime } from './web'

export type { OpenUrlMode, RuntimeAdapter, RuntimeKind, StorageAdapter } from './types'

const runtime: RuntimeAdapter = __PANEL_RUNTIME__ === 'extension'
  ? createExtensionRuntime()
  : createWebRuntime('web')

export function getRuntime(): RuntimeAdapter {
  return runtime
}
