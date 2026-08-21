import type { Response } from '@/utils/request'
import { post } from '@/utils/request'
import { getSyncRevision, notifySyncConflict, setSyncRevision } from '@/sync/revision'
import { isSyncRevision } from '@/sync/bootstrapSnapshot'
import { getBootstrap } from '@/api/sync'

interface MutationEnvelope<T> {
  revision: Sync.Revision
  result: T
}

export async function mutationPost<T>(url: string, data: unknown): Promise<Response<T>> {
  let expectedRevision: Sync.Revision
  try {
    expectedRevision = getSyncRevision()
  }
  catch {
    const bootstrap = await getBootstrap()
    if (bootstrap.code === 0 && bootstrap.data) {
      setSyncRevision(bootstrap.data.revision)
      expectedRevision = bootstrap.data.revision
    }
    else {
      expectedRevision = '0'
    }
  }

  const response = await post<MutationEnvelope<T>>({
    url,
    data: {
      expectedRevision,
      data,
    },
  })

  // Never replay a stale write automatically: doing so with a fresh revision
  // would silently overwrite a concurrent edit made on another device.
  if (response.code === 1502) {
    notifySyncConflict()
    return response as unknown as Response<T>
  }

  if (response.code !== 0)
    return response as unknown as Response<T>
  if (!response.data || !isSyncRevision(response.data.revision))
    throw new Error('Server returned an invalid mutation revision.')
  setSyncRevision(response.data.revision)
  return { ...response, data: response.data.result }
}
