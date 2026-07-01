/**
 * Watchdog.
 *
 * Monitors a long-running orchestration by polling a heartbeat timestamp. The
 * orchestrator calls `beat()` after every step; the watchdog checks on an
 * interval whether the heartbeat has gone stale (the process is wedged on a
 * hung command, an infinite wait, or has crashed mid-step). When it does, the
 * watchdog fires `onStale` so the orchestrator can abort the current step and
 * resume from the last checkpoint.
 */

export interface WatchdogOptions {
  /** Milliseconds without a beat before the run is considered stale. */
  staleMs: number
  /** How often to check, in ms. Defaults to staleMs / 3. */
  checkIntervalMs?: number
  /** Invoked when the heartbeat is stale; receives ms since last beat. */
  onStale: (sinceMs: number) => void
}

export class Watchdog {
  private lastBeat = Date.now()
  private timer: ReturnType<typeof setInterval> | null = null
  private firing = false

  constructor(private readonly opts: WatchdogOptions) {}

  /** Record that the orchestrator is alive. */
  beat(): void {
    this.lastBeat = Date.now()
  }

  /** Start monitoring. */
  start(): void {
    if (this.timer) return
    const interval = this.opts.checkIntervalMs ?? Math.max(1000, Math.floor(this.opts.staleMs / 3))
    this.timer = setInterval(() => this.check(), interval)
    // Don't keep the event loop alive solely for the watchdog.
    if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref()
  }

  /** Stop monitoring. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private check(): void {
    if (this.firing) return
    const since = Date.now() - this.lastBeat
    if (since >= this.opts.staleMs) {
      this.firing = true
      try {
        this.opts.onStale(since)
      } finally {
        // Reset the clock so we don't fire repeatedly for the same stall.
        this.lastBeat = Date.now()
        this.firing = false
      }
    }
  }

  get msSinceLastBeat(): number {
    return Date.now() - this.lastBeat
  }
}
