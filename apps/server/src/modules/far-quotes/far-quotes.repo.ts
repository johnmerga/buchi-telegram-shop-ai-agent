import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { farQuotes, zoneAcceptanceFactors } from '../../db/schema';

export type FarQuoteRow = typeof farQuotes.$inferSelect;
type NewFarQuote = typeof farQuotes.$inferInsert;

export class FarQuotesRepo {
  async insert(tx: Transaction, quote: NewFarQuote): Promise<FarQuoteRow> {
    const [row] = await tx.insert(farQuotes).values(quote).returning();
    if (!row) throw new Error('Insert returned no far quote');
    return row;
  }

  async insertMany(tx: Transaction, quotes: NewFarQuote[]): Promise<void> {
    if (quotes.length > 0) await tx.insert(farQuotes).values(quotes);
  }

  async find(tx: Transaction, quoteId: string): Promise<FarQuoteRow | undefined> {
    const [row] = await tx.select().from(farQuotes).where(eq(farQuotes.id, quoteId));
    return row;
  }

  async byOrder(tx: Transaction, orderId: string): Promise<FarQuoteRow | undefined> {
    const [row] = await tx.select().from(farQuotes).where(eq(farQuotes.orderId, orderId));
    return row;
  }

  /** Moves the quote on only from one of `from`, so a late button or timer changes nothing. */
  async move(
    tx: Transaction,
    quoteId: string,
    from: readonly FarQuoteRow['status'][],
    change: Partial<
      Pick<
        NewFarQuote,
        'status' | 'proposedPrice' | 'source' | 'decisionId' | 'heldPrice' | 'raises'
      >
    >,
  ): Promise<FarQuoteRow | undefined> {
    const [row] = await tx
      .update(farQuotes)
      .set({ ...change, updatedAt: sql`now()` })
      .where(and(eq(farQuotes.id, quoteId), inArray(farQuotes.status, [...from])))
      .returning();
    return row;
  }

  /** Quotes created since `since` that a driver held: the prices drivers accepted. */
  held(tx: Transaction, since: Date): Promise<FarQuoteRow[]> {
    return tx
      .select()
      .from(farQuotes)
      .where(and(isNotNull(farQuotes.heldPrice), gte(farQuotes.createdAt, since)));
  }

  /** Looks across all shops through the `far_quote_shop_ids` database function. */
  async shopIds(db: Database): Promise<string[]> {
    const rows = await db.execute<{ shop_id: string }>(
      sql`select shop_id from far_quote_shop_ids() as shop_id`,
    );
    return rows.map((row) => row.shop_id);
  }

  async saveFactors(
    tx: Transaction,
    shopId: string,
    rows: { zone: string; factor: number; trips: number }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await tx
      .insert(zoneAcceptanceFactors)
      .values(rows.map((row) => ({ ...row, shopId })))
      .onConflictDoUpdate({
        target: [zoneAcceptanceFactors.shopId, zoneAcceptanceFactors.zone],
        set: { factor: sql`excluded.factor`, trips: sql`excluded.trips`, updatedAt: sql`now()` },
      });
  }

  factors(
    tx: Transaction,
    zones: string[],
  ): Promise<{ zone: string; factor: number; trips: number }[]> {
    return tx
      .select({
        zone: zoneAcceptanceFactors.zone,
        factor: zoneAcceptanceFactors.factor,
        trips: zoneAcceptanceFactors.trips,
      })
      .from(zoneAcceptanceFactors)
      .where(inArray(zoneAcceptanceFactors.zone, zones));
  }
}
