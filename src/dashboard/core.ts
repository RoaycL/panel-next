export interface DashboardGroup extends Panel.ItemIconGroup {
  sortStatus?: boolean
  hoverStatus: boolean
  items: Panel.ItemInfo[]
}

export interface DashboardState {
  revision: Sync.Revision
  account: Sync.BootstrapAccount
  panelConfig: Panel.panelConfig
  searchEngine: Record<string, unknown>
  groups: DashboardGroup[]
}

/** Legacy settings shortcuts remain editable in settings, but no longer occupy a desktop page. */
export function isDesktopGroup(group: Panel.ItemIconGroup): boolean {
  return !['系统', 'system'].includes((group.title || '').trim().toLocaleLowerCase())
}

export function normalizeDashboardGroups(
  groups: readonly (Panel.ItemIconGroup & { items?: Panel.ItemInfo[] })[],
): DashboardGroup[] {
  return groups.map(group => ({
    ...group,
    hoverStatus: false,
    sortStatus: false,
    items: Array.isArray(group.items) ? [...group.items] : [],
  }))
}

export function createDashboardState(data: Sync.BootstrapResponseV1): DashboardState {
  return {
    revision: data.revision,
    account: { ...data.account },
    panelConfig: { ...data.panel.config },
    searchEngine: { ...data.panel.searchEngine },
    groups: normalizeDashboardGroups(data.panel.groups),
  }
}

export function filterDashboardGroups(
  groups: readonly DashboardGroup[],
  keyword: string | undefined,
  enabled: boolean,
): DashboardGroup[] {
  const query = keyword?.trim().toLocaleLowerCase()
  const desktopGroups = groups.filter(isDesktopGroup)
  if (!enabled || !query)
    return desktopGroups
  const result: DashboardGroup[] = []
  for (const group of desktopGroups) {
    const matches = group.items.filter((item) => {
      return item.title.toLocaleLowerCase().includes(query)
        || item.url.toLocaleLowerCase().includes(query)
        || item.lanUrl?.toLocaleLowerCase().includes(query)
        || item.description?.toLocaleLowerCase().includes(query)
    })
    if (matches.length)
      result.push({ ...group, items: matches })
  }
  return result
}

export function createItemSortRequest(group: DashboardGroup): Panel.ItemIconSortRequest | null {
  if (!group.id || !group.items.every(item => Boolean(item.id)))
    return null
  return {
    itemIconGroupId: group.id,
    sortItems: group.items.map((item, index) => ({ id: item.id as number, sort: index + 1 })),
  }
}

export function selectItemUrl(
  item: Panel.ItemInfo,
  preferLanOrMode: boolean | number | null | undefined,
): string {
  // PanelStateNetworkModeEnum.lan 是 0，PanelStateNetworkModeEnum.wan 是 1
  const preferLan = preferLanOrMode === true || preferLanOrMode === 0
  return preferLan && item.lanUrl ? item.lanUrl : item.url
}

// Browser-side conservative reachability checks; never probe from the server.
const smartCache = new Map<string, 'lan' | 'wan'>()

export async function smartSelectItemUrl(item: Panel.ItemInfo): Promise<string> {
  if (!item.lanUrl)
    return item.url

  const cacheKey = `${item.url}|${item.lanUrl}`
  const cached = smartCache.get(cacheKey)
  if (cached === 'lan')
    return item.lanUrl
  if (cached === 'wan')
    return item.url

  // Any HTTP answer from the LAN address proves the host is reachable: a no-cors
  // response is opaque, so a login or error page counts too, which is what LAN
  // detection needs. Network errors, blocked private-network requests and the
  // timeout count as unreachable.
  const probe = (target: string) => new Promise<boolean>((resolve) => {
    const img = new Image()
    const abort = new AbortController()
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (reachable: boolean) => { if (finished) return; finished = true; clearTimeout(timer); abort.abort(); img.onload = null; img.onerror = null; resolve(reachable) }
    timer = setTimeout(() => finish(false), 1800)
    img.onload = () => finish(true)
    img.onerror = () => { /* The page probe may work even without a favicon. */ }
    try {
      img.src = new URL('/favicon.ico', target).href
      void fetch(target, { method: 'HEAD', mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: abort.signal })
        .then(response => { if (response.type === 'opaque' || response.ok) finish(true) })
        .catch(() => { /* A browser security block is not proof of reachability. */ })
    }
    catch { finish(false) }
  })

  try {
    const result = await probe(item.lanUrl) ? 'lan' : 'wan'
    smartCache.set(cacheKey, result)
    setTimeout(() => smartCache.delete(cacheKey), 60_000)
    return result === 'lan' ? item.lanUrl : item.url
  }
  catch {
    return item.url
  }
}

export function resolveItemUrl(item: Panel.ItemInfo, mode: number | null | undefined): Promise<string> {
  return mode === 2 ? smartSelectItemUrl(item) : Promise.resolve(selectItemUrl(item, mode))
}
