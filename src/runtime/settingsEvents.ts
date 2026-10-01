const listeners = new Set<() => void>()
export function onSettingsChanged(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
export function notifySettingsChanged() { listeners.forEach(listener => listener()) }
