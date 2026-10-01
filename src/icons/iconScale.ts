// Keep legacy icons unchanged; malformed imported values must not escape the tile.
export function normalizeIconScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(2, Math.max(0.5, value))
    : 1
}
