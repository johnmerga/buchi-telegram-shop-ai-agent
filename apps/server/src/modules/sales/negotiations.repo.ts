import type { MoneyString } from '@buchi/shared';
import { and, countDistinct, eq, gte, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { negotiations } from '../../db/schema';

type NegotiationRow = typeof negotiations.$inferSelect;

export class NegotiationsRepo {
  async find(
    tx: Transaction,
    customerId: string,
    productId: string,
  ): Promise<NegotiationRow | undefined> {
    const [row] = await tx
      .select()
      .from(negotiations)
      .where(and(eq(negotiations.customerId, customerId), eq(negotiations.productId, productId)));
    return row;
  }

  async saveOffer(
    tx: Transaction,
    offer: {
      shopId: string;
      customerId: string;
      productId: string;
      agreedPrice: MoneyString;
      concessionsMade: number;
    },
  ): Promise<void> {
    await tx
      .insert(negotiations)
      .values(offer)
      .onConflictDoUpdate({
        target: [negotiations.customerId, negotiations.productId],
        set: {
          agreedPrice: offer.agreedPrice,
          concessionsMade: offer.concessionsMade,
          updatedAt: sql`now()`,
        },
      });
  }

  async take(
    tx: Transaction,
    customerId: string,
    productId: string,
  ): Promise<{ agreedPrice: MoneyString; updatedAt: Date } | undefined> {
    const [row] = await tx
      .delete(negotiations)
      .where(and(eq(negotiations.customerId, customerId), eq(negotiations.productId, productId)))
      .returning({ agreedPrice: negotiations.agreedPrice, updatedAt: negotiations.updatedAt });
    return row;
  }

  async countCustomersSince(tx: Transaction, productId: string, since: Date): Promise<number> {
    const [row] = await tx
      .select({ customers: countDistinct(negotiations.customerId) })
      .from(negotiations)
      .where(and(eq(negotiations.productId, productId), gte(negotiations.updatedAt, since)));
    return row?.customers ?? 0;
  }
}
