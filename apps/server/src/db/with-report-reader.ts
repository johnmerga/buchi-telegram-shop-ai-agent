import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client';
import { withShop } from './with-shop';

/**
 * Runs `work` for one shop as `report_reader`, which can only read the reporting views, in a
 * read-only transaction that stops any statement after three seconds. Row-level security of the
 * shop still applies, because the views run as `app_user`.
 */
export function withReportReader<T>(
  db: Database,
  shopId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withShop(db, shopId, async (tx) => {
    await tx.execute(sql`set transaction read only`);
    await tx.execute(sql`set local role report_reader`);
    await tx.execute(sql`set local statement_timeout = '3s'`);
    return work(tx);
  });
}
