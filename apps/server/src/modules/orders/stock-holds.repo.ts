import { and, eq } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { stockHolds } from '../../db/schema';

export class StockHoldsRepo {
  async insert(
    tx: Transaction,
    hold: { shopId: string; variantId: string; customerId: string; expiresAt: Date },
  ): Promise<string> {
    const [row] = await tx.insert(stockHolds).values(hold).returning({ id: stockHolds.id });
    if (!row) throw new Error('Insert returned no stock hold');
    return row.id;
  }

  /** Hands one held unit to the customer's order. Returns false when they hold none. */
  async use(tx: Transaction, customerId: string, variantId: string): Promise<boolean> {
    const [held] = await tx
      .select({ id: stockHolds.id })
      .from(stockHolds)
      .where(
        and(
          eq(stockHolds.customerId, customerId),
          eq(stockHolds.variantId, variantId),
          eq(stockHolds.status, 'held'),
        ),
      )
      .limit(1)
      .for('update');
    if (!held) return false;
    await tx.update(stockHolds).set({ status: 'used' }).where(eq(stockHolds.id, held.id));
    return true;
  }

  /** Ends a hold that is still held, and returns its variant so the unit can be released. */
  async release(tx: Transaction, holdId: string): Promise<string | undefined> {
    const [row] = await tx
      .update(stockHolds)
      .set({ status: 'released' })
      .where(and(eq(stockHolds.id, holdId), eq(stockHolds.status, 'held')))
      .returning({ variantId: stockHolds.variantId });
    return row?.variantId;
  }
}
