import { and, asc, count, desc, eq, inArray, isNotNull, lte, max, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { ledgerRows, sheetLedgers } from '../../db/schema';
import type { LedgerRow } from './ledger.domain';

export type QueuedLedgerRow = typeof ledgerRows.$inferSelect;

interface LedgerQueueState {
  pending: number;
  lastSentAt: Date | null;
  lastError: string | null;
}

/** Every query except `dueShopIds` runs inside `withShop`, so row-level security limits it. */
export class LedgerRepo {
  async spreadsheetId(tx: Transaction): Promise<string | null> {
    const [row] = await tx.select({ id: sheetLedgers.spreadsheetId }).from(sheetLedgers);
    return row?.id ?? null;
  }

  async setSpreadsheet(tx: Transaction, shopId: string, spreadsheetId: string): Promise<void> {
    await tx
      .insert(sheetLedgers)
      .values({ shopId, spreadsheetId })
      .onConflictDoUpdate({
        target: sheetLedgers.shopId,
        set: { spreadsheetId, updatedAt: sql`now()` },
      });
  }

  async removeSpreadsheet(tx: Transaction): Promise<void> {
    await tx.delete(sheetLedgers);
  }

  /** A row whose key is already queued is left as it is, so an event replay adds nothing. */
  async enqueue(tx: Transaction, shopId: string, row: LedgerRow, dueAt: Date): Promise<void> {
    await tx
      .insert(ledgerRows)
      .values({ shopId, ...row, nextAttemptAt: dueAt })
      .onConflictDoNothing({ target: [ledgerRows.shopId, ledgerRows.key] });
  }

  /**
   * Claims due rows and leases them until `leaseUntil` in one statement, so an attempt that crashes
   * is retried once the lease ends, and `SKIP LOCKED` keeps two ticks from claiming the same row.
   */
  claimDue(
    tx: Transaction,
    now: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<QueuedLedgerRow[]> {
    const due = tx
      .select({ id: ledgerRows.id })
      .from(ledgerRows)
      .where(and(eq(ledgerRows.status, 'pending'), lte(ledgerRows.nextAttemptAt, now)))
      .orderBy(asc(ledgerRows.createdAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    return tx
      .update(ledgerRows)
      .set({ attempts: sql`${ledgerRows.attempts} + 1`, nextAttemptAt: leaseUntil })
      .where(inArray(ledgerRows.id, due))
      .returning();
  }

  async markSent(tx: Transaction, ids: string[], sentAt: Date): Promise<void> {
    if (ids.length === 0) return;
    await tx
      .update(ledgerRows)
      .set({ status: 'sent', sentAt, lastError: null })
      .where(inArray(ledgerRows.id, ids));
  }

  async markFailed(tx: Transaction, id: string, error: string, retryAt: Date): Promise<void> {
    await tx
      .update(ledgerRows)
      .set({ lastError: error, nextAttemptAt: retryAt })
      .where(eq(ledgerRows.id, id));
  }

  async queueState(tx: Transaction): Promise<LedgerQueueState> {
    const [pending] = await tx
      .select({ count: count() })
      .from(ledgerRows)
      .where(eq(ledgerRows.status, 'pending'));
    const [sent] = await tx.select({ at: max(ledgerRows.sentAt) }).from(ledgerRows);
    const [failed] = await tx
      .select({ error: ledgerRows.lastError })
      .from(ledgerRows)
      .where(and(eq(ledgerRows.status, 'pending'), isNotNull(ledgerRows.lastError)))
      .orderBy(desc(ledgerRows.createdAt))
      .limit(1);
    return {
      pending: pending?.count ?? 0,
      lastSentAt: sent?.at ?? null,
      lastError: failed?.error ?? null,
    };
  }

  /**
   * Looks across all shops, which row-level security blocks, through the `ledger_due_shop_ids`
   * database function. It returns only shop IDs.
   */
  async dueShopIds(db: Database, now: Date): Promise<string[]> {
    const rows = await db.execute<{ shop_id: string }>(
      sql`select shop_id from ledger_due_shop_ids(${now.toISOString()}::timestamptz) as shop_id`,
    );
    return rows.map((row) => row.shop_id);
  }
}
