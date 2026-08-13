export const BOOTSTRAP_RETRY_DELAYS_MS = [0, 1000, 3000] as const

export interface RetryResult<T> {
  ok: boolean
  value?: T
  attempts: number
}

export async function retryNetworkOperation<T>(
  operation: () => Promise<T>,
  delays: readonly number[] = BOOTSTRAP_RETRY_DELAYS_MS,
  wait: (delay: number) => Promise<void> = delay => new Promise(resolve => window.setTimeout(resolve, delay)),
): Promise<RetryResult<T>> {
  let attempts = 0
  for (const delay of delays) {
    if (delay > 0)
      await wait(delay)
    attempts++
    try {
      return { ok: true, value: await operation(), attempts }
    }
    catch {
      // Only thrown transport failures are retried. API responses, including
      // authentication failures, are returned to the caller without retrying.
    }
  }
  return { ok: false, attempts }
}
