/** Package downloads bypass authenticated API clients; never send cookies/tokens. */
export function validatePackageUrl(input: string): URL {
  const url = new URL(input)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.includes('['))
    throw new Error('请输入公开 HTTPS 主题／组件包地址，不支持本地地址或带凭据的地址')
  return url
}

export async function downloadPackage(input: string): Promise<string> {
  const url = validatePackageUrl(input)
  const browser = (globalThis as typeof globalThis & {
    chrome?: { permissions?: { request: (value: { origins: string[] }) => Promise<boolean> } }
  }).chrome
  // Request immediately from the click handler, preserving Chrome's user gesture.
  if (browser?.permissions && !await browser.permissions.request({ origins: [`${url.origin}/*`] }))
    throw new Error('未授予访问组件发布网站的权限')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  const limit = 2 * 1024 * 1024
  try {
    const response = await fetch(url.href, {
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    })
    if (!response.ok || !response.body)
      throw new Error(`下载失败（${response.status}）`)
    if (Number(response.headers.get('content-length')) > limit)
      throw new Error('安装包超过 2 MB 限制')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done)
          break
        size += value.byteLength
        if (size > limit)
          throw new Error('安装包超过 2 MB 限制')
        chunks.push(value)
      }
    }
    finally {
      await reader.cancel().catch(() => {})
    }
    const buffer = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  }
  finally {
    clearTimeout(timer)
  }
}
