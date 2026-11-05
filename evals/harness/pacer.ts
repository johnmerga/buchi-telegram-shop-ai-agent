/** Spaces calls at least `intervalMs` apart, so a long run stays under a per-minute rate limit. */
export class Pacer {
  private nextAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly intervalMs: number,
    /** Milliseconds from a monotonic clock. */
    private readonly now: () => number,
    private readonly wait: (ms: number) => Promise<void>,
  ) {}

  /** Resolves when the caller may make its call. The slot is taken before waiting. */
  async turn(): Promise<void> {
    const now = this.now();
    const start = Math.max(now, this.nextAt);
    this.nextAt = start + this.intervalMs;
    if (start > now) await this.wait(start - now);
  }
}
