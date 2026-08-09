import request from '@/utils/request/axios'
import { useAppStore, useAuthStore } from '@/store'

interface RestoreResult {
  restartRequired: boolean
  preRestoreBackup: string
  formatVersion: number
}

interface ApiResponse<T> {
  code: number
  msg: string
  data?: T
}

function authHeaders() {
  return {
    token: useAuthStore().token,
    lang: useAppStore().language,
  }
}

export async function exportBackup() {
  const response = await request.get<Blob>('/system/backup/export', {
    headers: authHeaders(),
    responseType: 'blob',
  })
  const contentType = String(response.headers['content-type'] || '')
  if (contentType.includes('application/json')) {
    const payload = JSON.parse(await response.data.text()) as ApiResponse<never>
    throw new Error(payload.msg)
  }
  return response.data
}

export async function restoreBackup(file: File) {
  const form = new FormData()
  form.append('backup', file)
  const response = await request.post<ApiResponse<RestoreResult>>('/system/backup/restore', form, {
    headers: authHeaders(),
  })
  if (response.data.code !== 0 || !response.data.data)
    throw new Error(response.data.msg)
  return response.data.data
}
