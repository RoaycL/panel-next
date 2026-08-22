export type RuntimeKind = 'web' | 'extension'
export type OpenUrlMode = 'current' | 'tab'

export interface StorageChangeEvent {
  key: string
  oldValue: string | null
  newValue: string | null
  scope: 'runtime' | 'data'
}

export interface StorageAdapter {
  getItem: (key: string) => string | null
  keys?: () => string[]
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
  flush?: () => Promise<void>
  sync?: () => Promise<void>
  subscribe?: (listener: (change: StorageChangeEvent) => void) => () => void
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind
  readonly storage: StorageAdapter
  ready: () => Promise<void>
  getApiBaseUrl: () => string
  getServerOrigin: () => string | null
  configureServer: (serverUrl: string) => Promise<string>
  resolveUrl: (url: string) => string
  resolveNavigationUrl: (url: string) => string
  openUrl: (url: string, mode: OpenUrlMode) => void
}
