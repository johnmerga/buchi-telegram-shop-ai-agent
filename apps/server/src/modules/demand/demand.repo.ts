import { and, cosineDistance, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { demandSignals, waitlist } from '../../db/schema';

export class DemandRepo {
  async insertSignal(
    tx: Transaction,
    signal: { shopId: string; customerId: string; description: string; embedding: number[] },
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

  /** Joining twice keeps the first place in the line, and returns false. */
  async joinWaitlist(
    tx: Transaction,
    entry: { shopId: string; customerId: string; variantId: string },
  ): Promise<boolean> {
    const inserted = await tx
      .insert(waitlist)
      .values(entry)
      .onConflictDoNothing()
      .returning({ id: waitlist.id });
    return inserted.length > 0;
  }

  async markNotified(tx: Transaction, variantId: string, customerId: string): Promise<void> {
    await tx
      .update(waitlist)
      .set({ notifiedAt: sql`now()` })
      .where(and(eq(waitlist.variantId, variantId), eq(waitlist.customerId, customerId)));
  }

  /**
   * Marks the **Notify me** requests whose photo is close to a product as told, in one statement,
   * and returns their customers, so each request is answered once.
   */
  async claimSimilarRequests(
    tx: Transaction,
    embedding: number[],
    maxDistance: number,
  ): Promise<string[]> {
    const rows = await tx
      .update(demandSignals)
      .set({ notifiedAt: sql`now()` })
      .where(
        and(
          eq(demandSignals.notifyRequested, true),
          isNull(demandSignals.notifiedAt),
          isNotNull(demandSignals.embedding),
          lte(cosineDistance(demandSignals.embedding, embedding), maxDistance),
        ),
      )
      .returning({ customerId: demandSignals.customerId });
    return [...new Set(rows.map((row) => row.customerId))];
  }

  /** Customers still waiting for the variant, in the order they joined. */
  async waiting(tx: Transaction, variantId: string): Promise<string[]> {
    const rows = await tx
      .select({ customerId: waitlist.customerId })
      .from(waitlist)
      .where(and(eq(waitlist.variantId, variantId), isNull(waitlist.notifiedAt)))
      .orderBy(waitlist.joinedAt);
    return rows.map((row) => row.customerId);
  }
}
