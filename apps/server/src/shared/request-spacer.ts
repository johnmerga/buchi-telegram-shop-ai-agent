/**
 * Runs calls one at a time and starts each at least `intervalMs` after the previous one started,
 * for services whose usage policy limits the request rate.
 */
export class RequestSpacer {
  private queue: Promise<void> = Promise.resolve();
  private lastStart = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => Date,
    private readonly wait: (ms: number) => Promise<void>,
  ) {}

  run<T>(call: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const delay = this.lastStart + this.intervalMs - this.now().getTime();
      if (delay > 0) await this.wait(delay);
      this.lastStart = this.now().getTime();
      return call();
    });
    // The caller handles the call's failure. The queue only needs to know that it finished.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
