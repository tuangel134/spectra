/**
 * HTTP helper for provider requests with timeout support.
 */

import { ProviderError } from "./types.js"

export interface HttpRequestOptions {
  url: string
  headers: Record<string, string>
  body: unknown
  timeout: number
  /** External abort signal (e.g. turn cancellation). */
  signal?: AbortSignal
  /** Optional: notified before each retry (attempt#, wait ms, HTTP status). */
  onRetry?: (attempt: number, waitMs: number, status?: number) => void
}

/**
 * Parse a `retry-after` header into seconds. The header is either a number of
 * seconds or an HTTP date; returns undefined when absent/unparseable.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const secs = Number(value)
  if (Number.isFinite(secs) && secs >= 0) return secs
  const when = Date.parse(value)
  if (!Number.isNaN(when)) {
    const delta = Math.round((when - Date.now()) / 1000)
    return delta > 0 ? delta : 0
  }
  return undefined
}

/** Perform a JSON POST request with retries + exponential backoff on 5xx. */
export async function postJson<T>(options: HttpRequestOptions): Promise<T> {
  const maxRetries = 2
  let lastErr: ProviderError | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await doPost<T>(options)
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err
      lastErr = err
      // Never retry a caller cancellation — propagate it promptly.
      if (options.signal?.aborted) throw err
      const isLast = attempt === maxRetries
      const transient = !err.status || err.status >= 500 // 5xx or network error
      // A 429 with a SHORT retry-after is a per-second/minute burst limit worth
      // waiting out. A long (or absent) one means the quota is exhausted → let
      // the loop's Autochange switch models instead of blocking here.
      const shortRateLimit =
        err.status === 429 && err.retryAfter !== undefined && err.retryAfter <= 8
      if (isLast || (!transient && !shortRateLimit)) throw err
      const waitMs = shortRateLimit
        ? err.retryAfter! * 1000 + 250
        : 500 * Math.pow(2, attempt)
      try {
        options.onRetry?.(attempt + 1, waitMs, err.status)
      } catch {
        /* onRetry is best-effort telemetry — never let it break the retry loop */
      }
      await sleep(waitMs)
    }
  }
  throw lastErr!
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function doPost<T>(options: HttpRequestOptions): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout)
  // Abort immediately if the caller's external signal fires (turn cancel).
  const onExternalAbort = (): void => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener("abort", onExternalAbort, { once: true })
  }

  try {
    const response = await fetch(options.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...options.headers,
      },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    })

    const text = await response.text()

    if (!response.ok) {
      throw new ProviderError(
        `Request to ${options.url} failed with status ${response.status}`,
        response.status,
        text,
        parseRetryAfter(response.headers.get("retry-after")),
      )
    }

    try {
      return JSON.parse(text) as T
    } catch {
      throw new ProviderError(
        `Failed to parse JSON response from ${options.url}`,
        response.status,
        text,
      )
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err
    if (err instanceof Error && err.name === "AbortError") {
      // Distinguish a caller cancellation from a timeout.
      if (options.signal?.aborted) throw new ProviderError(`Request to ${options.url} was cancelled`)
      throw new ProviderError(`Request to ${options.url} timed out after ${options.timeout}ms`)
    }
    throw new ProviderError(
      `Network error contacting ${options.url}: ${(err as Error).message}`,
    )
  } finally {
    clearTimeout(timer)
    if (options.signal) options.signal.removeEventListener("abort", onExternalAbort)
  }
}
