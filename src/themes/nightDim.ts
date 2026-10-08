/** Default night dim when the user has not chosen one: noticeable but keeps colours readable. */
export const DEFAULT_NIGHT_DIM = 0.2
export const MAX_NIGHT_DIM = 0.6

export function clampNightDim(value: number | undefined): number {
  const dim = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_NIGHT_DIM
  return Math.min(MAX_NIGHT_DIM, Math.max(0, dim))
}
