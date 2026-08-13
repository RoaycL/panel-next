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
