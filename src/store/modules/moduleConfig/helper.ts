import { persistentStorage } from '@/utils/storage'
// import userDefaultAvatar from '@/assets/userDefaultAvatar.png'

const LOCAL_NAME = 'moduleConfig'

export interface Config {
  name: string
  config: any
}

export interface ModuleConfigState {
  [key: string]: any
}

export function getLocalState(): ModuleConfigState {
  const localSetting = persistentStorage.get<ModuleConfigState>(LOCAL_NAME)
  return { ...localSetting }
}

export function setLocalState(setting: ModuleConfigState): void {
  persistentStorage.set(LOCAL_NAME, setting)
}
