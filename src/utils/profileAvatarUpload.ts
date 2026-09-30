export const AVATAR_UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
export const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024

export function validateAvatarUpload(file: { name: string; type: string; size: number }): string | null {
  if (!/\.(?:png|jpe?g|webp|gif)$/i.test(file.name) || !AVATAR_UPLOAD_ACCEPT.split(',').includes(file.type))
    return '请选择 PNG、JPG、WebP 或 GIF 图片'
  if (file.size <= 0 || file.size > MAX_AVATAR_UPLOAD_BYTES)
    return '头像图片需大于 0 且不超过 2 MB'
  return null
}

export function readUploadedAvatar(response: string): string {
  let result: { code?: number; msg?: string; data?: { imageUrl?: unknown } }
  try {
    result = JSON.parse(response)
  }
  catch {
    throw new Error('服务器返回异常，请重新上传头像')
  }
  if (!result || result.code !== 0)
    throw new Error(result?.msg || '头像上传失败，请稍后重试')
  const url = typeof result.data?.imageUrl === 'string' ? result.data.imageUrl.trim() : ''
  // Accept existing server material paths or HTTP(S) URLs, never executable schemes.
  if (!url || url.length > 200 || /[\s\\]/.test(url) || url.startsWith('//') || (/^[a-z][\w+.-]*:/i.test(url) && !/^https?:\/\//i.test(url)))
    throw new Error('服务器未返回有效的头像地址，请重新上传')
  try {
    const parsed = new URL(url, 'https://avatar.invalid/')
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error('Invalid image URL')
  }
  catch {
    throw new Error('服务器未返回有效的头像地址，请重新上传')
  }
  return url
}
