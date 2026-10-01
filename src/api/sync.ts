import { get } from '@/utils/request'

export function getBootstrap() {
  return get<Sync.BootstrapResponse>({
    url: '/v1/sync/bootstrap',
    headers: { 'X-Panel-API-Version': '1' },
    silentNetworkError: true,
  })
}

export function getChanges(since: Sync.Revision, limit = 200) {
  return get<Sync.ChangesResponseV1>({
    url: '/v1/sync/changes',
    data: { since, limit },
    headers: { 'X-Panel-API-Version': '1' },
    silentNetworkError: true,
  })
}

export function waitForSyncChange(since: Sync.Revision, signal: AbortSignal) {
  return get<{ revision: Sync.Revision, changed: boolean }>({
    url: '/v1/sync/wait',
    timeout: 35000, // The server holds a successful long poll for up to 25 seconds.
    data: { since },
    headers: { 'X-Panel-API-Version': '1' },
    signal,
    silentNetworkError: true,
  })
}
