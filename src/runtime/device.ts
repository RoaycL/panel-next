import { getRuntime } from './index'

const DEVICE_ID_KEY = 'PANEL_NEXT_DEVICE_ID'

export interface DeviceIdentity {
  deviceId: string
  deviceName: string
  clientType: 'web' | 'chrome_extension'
}

export function getDeviceIdentity(): DeviceIdentity {
  const runtime = getRuntime()
  const existing = runtime.storage.getItem(DEVICE_ID_KEY)
  const deviceId = existing || crypto.randomUUID()
  if (!existing)
    runtime.storage.setItem(DEVICE_ID_KEY, deviceId)

  const platform = navigator.platform?.trim()
  const clientType = runtime.kind === 'extension' ? 'chrome_extension' : 'web'
  const clientName = runtime.kind === 'extension' ? 'Chrome Extension' : 'Web'
  return {
    deviceId,
    deviceName: platform ? `${clientName} · ${platform}` : clientName,
    clientType,
  }
}
