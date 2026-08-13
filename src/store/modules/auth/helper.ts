import type { AuthState } from './index'
import { persistentStorage } from '@/utils/storage'

const LOCAL_NAME = 'AUTH_TOKEN'

export function setStorage(state: AuthState) {
  return persistentStorage.set(LOCAL_NAME, state)
}

export function getStorage() {
  return persistentStorage.get<Partial<AuthState>>(LOCAL_NAME)
}

export function removeToken() {
  return persistentStorage.remove(LOCAL_NAME)
}
