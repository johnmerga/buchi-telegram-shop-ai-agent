import { and, eq } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { demandSignals, waitlist } from '../../db/schema';

export class DemandRepo {
  async insertSignal(
    tx: Transaction,
    signal: { shopId: string; customerId: string; description: string },
  ): Promise<string> {
    const [row] = await tx.insert(demandSignals).values(signal).returning({ id: demandSignals.id });
    if (!row) throw new Error('Insert returned no demand signal');
    return row.id;
  }

  /** Only the customer who sent the photo can ask to be notified about it. */
  async requestNotify(tx: Transaction, signalId: string, customerId: string): Promise<boolean> {
    const updated = await tx
      .update(demandSignals)
      .set({ notifyRequested: true })
      .where(and(eq(demandSignals.id, signalId), eq(demandSignals.customerId, customerId)))
      .returning({ id: demandSignals.id });
    return updated.length > 0;
  }

  /** Joining twice keeps the first place in the line. */
  async joinWaitlist(
    tx: Transaction,
    entry: { shopId: string; customerId: string; variantId: string },
  ): Promise<void> {
    await tx.insert(waitlist).values(entry).onConflictDoNothing();
  }
}
