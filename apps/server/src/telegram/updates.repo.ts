import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Update } from 'grammy/types';
import type { Database } from '../db/client';
import { telegramUpdates as updates } from '../db/schema';

export class TelegramUpdatesRepo {
  constructor(private readonly db: Database) {}

  /** Returns false when Telegram resends an update that is already stored. */
  async insertIfNew(update: Update): Promise<boolean> {
    const inserted = await this.db
      .insert(updates)
      .values({ updateId: update.update_id, payload: update })
      .onConflictDoNothing()
      .returning({ updateId: updates.updateId });
    return inserted.length > 0;
  }

  /** Claims the oldest pending update, so updates from one chat run in the order Telegram sent them. */
  async claimNext(): Promise<Update | undefined> {
    const oldestPending = this.db
      .select({ updateId: updates.updateId })
      .from(updates)
      .where(eq(updates.status, 'pending'))
      .orderBy(updates.updateId)
      .limit(1)
      .for('update', { skipLocked: true });
    const [claimed] = await this.db
      .update(updates)
      .set({ status: 'processing' })
      .where(inArray(updates.updateId, oldestPending))
      .returning({ payload: updates.payload });
    return claimed?.payload;
  }

  async markDone(updateId: number): Promise<void> {
    await this.db
      .update(updates)
      .set({ status: 'done', processedAt: sql`now()` })
      .where(eq(updates.updateId, updateId));
  }

  async markFailed(updateId: number, error: string): Promise<void> {
    await this.db
      .update(updates)
      .set({ status: 'failed', error, processedAt: sql`now()` })
      .where(eq(updates.updateId, updateId));
  }

  /**
   * Deletes processed updates received before `before`. They hold shared contacts and locations,
   * and deduplication only needs the recent ones. Returns how many it deleted.
   */
  async deleteProcessedBefore(before: Date): Promise<number> {
    const deleted = await this.db
      .delete(updates)
      .where(and(inArray(updates.status, ['done', 'failed']), lt(updates.receivedAt, before)))
      .returning({ updateId: updates.updateId });
    return deleted.length;
  }

  /** Returns updates that a crash interrupted to the queue. Safe because one instance processes updates. */
  async requeueInterrupted(): Promise<void> {
    await this.db
      .update(updates)
      .set({ status: 'pending' })
      .where(eq(updates.status, 'processing'));
  }
}
