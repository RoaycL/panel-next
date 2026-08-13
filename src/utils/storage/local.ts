import { deCrypto, enCrypto } from '../crypto'
import { getRuntime } from '@/runtime'

interface StorageData<T = any> {
  data: T
  expire: number | null
}

export function createLocalStorage(options?: { expire?: number | null; crypto?: boolean }) {
  const DEFAULT_CACHE_TIME = 60 * 60 * 24 * 7

  const { expire, crypto } = Object.assign(
    {
      expire: DEFAULT_CACHE_TIME,
      crypto: true,
    },
    options,
  )

  function set<T = any>(key: string, data: T) {
    const storageData: StorageData<T> = {
      data,
      expire: expire !== null ? new Date().getTime() + expire * 1000 : null,
    }

    const json = crypto ? enCrypto(storageData) : JSON.stringify(storageData)
    getRuntime().storage.setItem(key, json)
  }

  function get<T = unknown>(key: string): T | null {
    const json = getRuntime().storage.getItem(key)
    if (json) {
      let storageData: StorageData | null = null

      try {
        storageData = crypto ? deCrypto(json) : JSON.parse(json)
      }
      catch {
        // Prevent failure
      }

      if (storageData) {
        const { data, expire } = storageData
        if (expire === null || expire >= Date.now())
          return data as T
      }

      remove(key)
      return null
    }
    return null
  }

  function remove(key: string) {
    getRuntime().storage.removeItem(key)
  }

  function clear() {
    getRuntime().storage.clear()
  }

  return {
    set,
    get,
    remove,
    clear,
  }
}

export const expiringStorage = createLocalStorage()

/** Persistent JSON storage backed by the active Runtime StorageAdapter. */
export const persistentStorage = createLocalStorage({ expire: null, crypto: false })
