import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client';

/**
 * Runs `work` in a transaction where row-level security limits every query to one shop.
 * Both settings are transaction-local, so they reset when the connection returns to the pool.
 */
export function withShop<T>(
  db: Database,
  shopId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.shop_id', ${shopId}, true)`);
    await tx.execute(sql`set local role app_user`);
    return work(tx);
  });
}
