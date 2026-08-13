export function resolveHttpUrl(url: string, baseUrl: string) {
  const target = new URL(url, baseUrl)
  if (target.protocol !== 'http:' && target.protocol !== 'https:')
    throw new Error('Only HTTP and HTTPS links can be opened.')
  return target.href
}
