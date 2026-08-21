import { getRuntime } from './index'

const DEVICE_ID_KEY = 'PANEL_NEXT_DEVICE_ID'

export interface DeviceIdentity {
  deviceId: string
  deviceName: string
  clientType: 'web' | 'chrome_extension'
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID()
    }
    catch {
      // ignore
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function getDeviceIdentity(): DeviceIdentity {
  const runtime = getRuntime()
  const existing = runtime.storage.getItem(DEVICE_ID_KEY)
  const deviceId = existing || generateUUID()
  if (!existing)
    runtime.storage.setItem(DEVICE_ID_KEY, deviceId)

  const platform = navigator?.platform?.trim?.() ?? ''
  const clientType = runtime.kind === 'extension' ? 'chrome_extension' : 'web'
  const clientName = runtime.kind === 'extension' ? 'Chrome Extension' : 'Web'
  return {
    deviceId,
    deviceName: platform ? `${clientName} · ${platform}` : clientName,
    clientType,
  }
}
