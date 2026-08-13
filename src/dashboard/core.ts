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
