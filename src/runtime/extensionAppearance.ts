import { getRuntime } from '@/runtime'

const EXTENSION_APPEARANCE_KEY = 'PANEL_NEXT_EXTENSION_APPEARANCE_V1'

function isPanelConfig(value: unknown): value is Panel.panelConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Extension-only visual preferences. Groups, bookmarks and account data remain server-backed. */
export function readExtensionAppearance(): Panel.panelConfig | null {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return null

  const raw = runtime.storage.getItem(EXTENSION_APPEARANCE_KEY)
  if (!raw)
    return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isPanelConfig(parsed) ? parsed : null
  }
  catch {
    runtime.storage.removeItem(EXTENSION_APPEARANCE_KEY)
    return null
  }
}

export function saveExtensionAppearance(config: Panel.panelConfig) {
  const runtime = getRuntime()
  if (runtime.kind !== 'extension')
    return
  runtime.storage.setItem(EXTENSION_APPEARANCE_KEY, JSON.stringify(config))
  void runtime.storage.flush?.().catch(error => console.error('Failed to save extension appearance.', error))
}

