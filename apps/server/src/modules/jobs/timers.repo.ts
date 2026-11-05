import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { timers } from '../../db/schema';

export type Timer = typeof timers.$inferSelect;

export class TimersRepo {
  constructor(private readonly db: Database) {}

  /** Inserts in the caller's transaction, so a timer exists only if the change it guards commits. */
  async schedule(
    tx: Transaction,
    kind: string,
    targetId: string,
    shopId: string | null,
    dueAt: Date,
  ): Promise<Timer> {
    const [timer] = await tx.insert(timers).values({ kind, targetId, shopId, dueAt }).returning();
    if (timer === undefined) {
      throw new Error('Insert into timers returned no row');
    }
    return timer;
  }

  /**
   * Claims up to `limit` due timers in one statement. `SKIP LOCKED` lets concurrent ticks claim
   * disjoint rows instead of waiting for each other or running the same timer twice.
   */
  claimDue(limit: number): Promise<Timer[]> {
    const due = this.db
      .select({ id: timers.id })
      .from(timers)
      .where(and(eq(timers.status, 'pending'), lte(timers.dueAt, sql`now()`)))
      .orderBy(timers.dueAt)
      .limit(limit)
      .for('update', { skipLocked: true });
    return this.db
      .update(timers)
      .set({ status: 'running', attempts: sql`${timers.attempts} + 1`, updatedAt: sql`now()` })
      .where(inArray(timers.id, due))
      .returning();
  }

  /**
   * Returns timers claimed before `leaseMs` ago and still running, whose tick crashed, to the
   * queue. A timer already claimed `maxAttempts` times fails instead, so a handler that crashes the
   * process cannot loop forever. Returns how many it requeued and how many it failed.
   */
  async reclaimStuck(
    leaseMs: number,
    maxAttempts: number,
  ): Promise<{ requeued: number; failed: number }> {
    const exhausted = sql`${timers.attempts} >= ${maxAttempts}`;
    const rows = await this.db
      .update(timers)
      .set({
        status: sql`case when ${exhausted} then 'failed'::timer_status else 'pending'::timer_status end`,
        lastError: sql`case when ${exhausted} then ${`Interrupted ${String(maxAttempts)} times`} else 'Interrupted' end`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(timers.status, 'running'),
          lt(timers.updatedAt, sql`now() - ${leaseMs}::int * interval '1 millisecond'`),
        ),
      )
      .returning({ status: timers.status });
    const failed = rows.filter((row) => row.status === 'failed').length;
    return { requeued: rows.length - failed, failed };
  }

  /**
   * Finishes the claim that `timer` came from. A claim whose lease ran out, and whose timer was
   * claimed again, changes nothing, so only the latest claim decides the result.
   */
  async markDone(timer: Timer): Promise<void> {
    await this.db
      .update(timers)
      .set({ status: 'done', updatedAt: sql`now()` })
      .where(this.currentClaim(timer));
  }

  async markFailed(timer: Timer, error: string): Promise<void> {
    await this.db
      .update(timers)
      .set({ status: 'failed', lastError: error, updatedAt: sql`now()` })
      .where(this.currentClaim(timer));
  }

  private currentClaim(timer: Timer) {
    return and(
      eq(timers.id, timer.id),
      eq(timers.status, 'running'),
      eq(timers.attempts, timer.attempts),
    );
  }
}
