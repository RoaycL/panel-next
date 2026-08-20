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
  if (!enabled || !query)
    return groups as DashboardGroup[]
  const result: DashboardGroup[] = []
  for (const group of groups) {
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

export function selectItemUrl(item: Panel.ItemInfo, preferLan: boolean) {
  return preferLan && item.lanUrl ? item.lanUrl : item.url
}

// CARD-08: 实验性智能选择内网/默认地址。
// 当卡片同时配置了 wanUrl 和 lanUrl 时，通过简单延迟探测选择更快的地址。
// 探测在浏览器空闲时进行，结果缓存到内存 Map 避免重复探测。
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

  // 并行探测两个地址，取更快的
  const probe = (url: string) => new Promise<number>((resolve) => {
    const img = new Image()
    const start = performance.now()
    img.onload = () => resolve(performance.now() - start)
    img.onerror = () => resolve(performance.now() - start)
    img.src = `${url}/favicon.ico?_=${Date.now()}`
    setTimeout(() => resolve(9999), 3000)
  })

  try {
    const [wanTime, lanTime] = await Promise.all([
      probe(item.url),
      probe(item.lanUrl),
    ])
    const result = lanTime < wanTime ? 'lan' : 'wan'
    smartCache.set(cacheKey, result)
    return result === 'lan' ? item.lanUrl : item.url
  }
  catch {
    return item.url
  }
}
