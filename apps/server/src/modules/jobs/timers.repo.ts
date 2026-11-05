import { and, eq, inArray, lte, sql } from 'drizzle-orm';
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

  async markDone(id: string): Promise<void> {
    await this.db
      .update(timers)
      .set({ status: 'done', updatedAt: sql`now()` })
      .where(eq(timers.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db
      .update(timers)
      .set({ status: 'failed', lastError: error, updatedAt: sql`now()` })
      .where(eq(timers.id, id));
  }
}
