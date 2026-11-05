/**
 * Counts requests per key in fixed windows. In memory, because Buchi runs as one instance. Keys
 * whose window has ended are dropped once per window, so memory stays bounded by recent callers.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private lastSweep = 0;

  constructor(private readonly options: { limit: number; windowMs: number; now: () => Date }) {}

  /** Counts one request for `key`. Returns 0 when it is allowed, or the milliseconds until it is. */
  take(key: string): number {
    const now = this.options.now().getTime();
    this.sweep(now);
    const window = this.windows.get(key);
    if (window === undefined || this.ended(window, now)) {
      this.windows.set(key, { start: now, count: 1 });
      return 0;
    }
    if (window.count >= this.options.limit) return window.start + this.options.windowMs - now;
    window.count += 1;
    return 0;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.options.windowMs) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (this.ended(window, now)) this.windows.delete(key);
    }
  }

  private ended(window: { start: number }, now: number): boolean {
    return now - window.start >= this.options.windowMs;
  }
}
