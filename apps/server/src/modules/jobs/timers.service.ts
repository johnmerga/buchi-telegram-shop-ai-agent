import type { Logger } from 'pino';
import type { Transaction } from '../../db/client';
import type { Timer, TimersRepo } from './timers.repo';

type TimerHandler = (timer: Timer) => Promise<void>;

// A type alias, not an interface, so it fits the jobs' `Record<string, number>` summary type.
type TickSummary = {
  requeued: number;
  done: number;
  failed: number;
};

/** Keeps one tick well inside the HTTP timeout of the cron service that calls it. */
export const TICK_BATCH_SIZE = 50;
/**
 * How long a claimed timer may run before another tick treats its tick as crashed. Far longer than
 * any tick takes, so a slow handler is not run twice at the same time.
 */
const RUNNING_LEASE_MS = 10 * 60_000;
/** Claims per timer, so a handler that crashes the process stops after a few restarts. */
const MAX_ATTEMPTS = 3;

/** Runs due timers through the handler registered for their kind. */
export class TimerService {
  private readonly handlers = new Map<string, TimerHandler>();

  constructor(
    private readonly repo: TimersRepo,
    private readonly logger: Logger,
  ) {}

  register(kind: string, handler: TimerHandler): void {
    if (this.handlers.has(kind)) {
      throw new Error(`A timer handler for "${kind}" is already registered`);
    }
    this.handlers.set(kind, handler);
  }

  schedule(
    tx: Transaction,
    kind: string,
    targetId: string,
    shopId: string | null,
    dueAt: Date,
  ): Promise<Timer> {
    return this.repo.schedule(tx, kind, targetId, shopId, dueAt);
  }

  async tick(): Promise<TickSummary> {
    const { requeued, failed } = await this.repo.reclaimStuck(RUNNING_LEASE_MS, MAX_ATTEMPTS);
    if (requeued + failed > 0) {
      this.logger.warn({ requeued, failed }, 'reclaimed timers stuck in running');
    }
    const claimed = await this.repo.claimDue(TICK_BATCH_SIZE);
    const summary: TickSummary = { requeued, done: 0, failed };
    for (const timer of claimed) {
      if (await this.run(timer)) {
        summary.done += 1;
      } else {
        summary.failed += 1;
      }
    }
    return summary;
  }

  /** Records a handler failure on the timer, so one failure never stops the rest of the tick. */
  private async run(timer: Timer): Promise<boolean> {
    try {
      const handler = this.handlers.get(timer.kind);
      if (handler === undefined) {
        throw new Error(`No timer handler for "${timer.kind}"`);
      }
      await handler(timer);
    } catch (err) {
      this.logger.error({ err, timerId: timer.id, kind: timer.kind }, 'timer failed');
      await this.repo.markFailed(timer, err instanceof Error ? err.message : String(err));
      return false;
    }
    await this.repo.markDone(timer);
    return true;
  }
}
