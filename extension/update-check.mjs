export const UPDATE_KEY = 'panel-next-extension-update'
export const UPDATE_ALARM = 'panel-next-update-check'
export const UPDATE_INTERVAL_MINUTES = 10
export const RELEASES_API = 'https://api.github.com/repos/RoaycL/panel-next/releases?per_page=30'

export function compareVersions(a, b) {
  const parse = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) throw new Error('Invalid release version')
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  }
  return 0
}

export function selectRelease(releases, currentVersion) {
  if (!Array.isArray(releases)) throw new Error('Invalid release response')
  const testing = currentVersion.startsWith('0.0.')
  let latest = null
  for (const release of releases) {
    if (release.draft || (release.prerelease && !testing)) continue
    const version = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name || '')?.[1]
    if (!version || compareVersions(version, currentVersion) <= 0) continue
    const archive = `panel-next-extension-v${version}.zip`
    const assets = release.assets || []
    if (![archive, `${archive}.sha256`].every(name => assets.some(asset => asset.name === name && asset.size > 0 && asset.state === 'uploaded'))) continue
    if (!latest || compareVersions(version, latest.version) > 0) {
      const releaseUrl = `https://github.com/RoaycL/panel-next/releases/tag/v${version}`
      latest = { version, releaseUrl, downloadUrl: `https://github.com/RoaycL/panel-next/releases/download/v${version}/${archive}` }
    }
  }
  return latest
}

export function createUpdateChecker({ storage, fetcher, currentVersion, now = Date.now }) {
  let pending = null
  return function check() {
    if (pending) return pending
    pending = (async () => {
      const previous = (await storage.get(UPDATE_KEY))[UPDATE_KEY] || {}
      if (previous.latest && compareVersions(previous.latest.version, currentVersion) <= 0) {
        previous.latest = null
        previous.checkedAt = undefined
      }
      previous.currentVersion = currentVersion
      if (previous.retryAfter > now()) return previous
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12000)
      try {
        const response = await fetcher(RELEASES_API, { signal: controller.signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } })
        if (!response.ok) {
          if (response.status === 403 || response.status === 429) {
            const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
            const retry = Number(response.headers.get('retry-after')) * 1000
            const retryAfter = Math.min(now() + 3600000, Math.max(now() + 600000, reset || 0, now() + (retry || 0)))
            const state = { ...previous, currentVersion, error: '检查频率受限，稍后自动重试', retryAfter }
            await storage.set({ [UPDATE_KEY]: state })
            return state
          }
          throw new Error('Release request failed')
        }
        const latest = selectRelease(await response.json(), currentVersion)
        const fresh = (await storage.get(UPDATE_KEY))[UPDATE_KEY] || previous
        const state = { currentVersion, latest, checkedAt: now(), error: '', retryAfter: 0, dismissedVersion: fresh.dismissedVersion || '' }
        await storage.set({ [UPDATE_KEY]: state })
        return state
      }
      catch {
        const state = { ...previous, currentVersion, error: '暂时无法检查更新，请稍后重试' }
        await storage.set({ [UPDATE_KEY]: state })
        return state
      }
      finally { clearTimeout(timer) }
    })().finally(() => { pending = null })
    return pending
  }
}
