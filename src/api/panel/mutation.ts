import type { Response } from '@/utils/request'
import { post } from '@/utils/request'
import { getSyncRevision, notifySyncConflict, setSyncRevision } from '@/sync/revision'
import { isSyncRevision } from '@/sync/bootstrapSnapshot'

interface MutationEnvelope<T> {
  revision: Sync.Revision
  result: T
}

export async function mutationPost<T>(url: string, data: unknown): Promise<Response<T>> {
  const response = await post<MutationEnvelope<T>>({
    url,
    data: {
      expectedRevision: getSyncRevision(),
      data,
    },
  })
  if (response.code === 1502)
    notifySyncConflict()
  if (response.code !== 0)
    return response as unknown as Response<T>
  if (!response.data || !isSyncRevision(response.data.revision))
    throw new Error('Server returned an invalid mutation revision.')
  setSyncRevision(response.data.revision)
  return { ...response, data: response.data.result }
}
