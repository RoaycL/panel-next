export function normalizeSearchHistory(entries: unknown): string[] {
  if (!Array.isArray(entries)) return []
  return Array.from(new Set(entries.filter((item): item is string => typeof item === 'string')
    .map(item => item.trim()).filter(item => item.length > 0 && item.length <= 200))).slice(0, 10)
}
export function addSearchHistory(entries: string[], query: string): string[] {
  return normalizeSearchHistory([query, ...entries])
}
