export type RuntimeKind = 'web' | 'extension'
export type OpenUrlMode = 'current' | 'tab'

export interface StorageAdapter {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind
  readonly storage: StorageAdapter
  ready: () => Promise<void>
  getApiBaseUrl: () => string
  openUrl: (url: string, mode: OpenUrlMode) => void
}
