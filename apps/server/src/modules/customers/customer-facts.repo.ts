import { asc, eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { customerFacts } from '../../db/schema';

type CustomerFactRow = typeof customerFacts.$inferSelect;

export class CustomerFactsRepo {
  /** A new fact under a key the customer already has replaces it, such as a changed shoe size. */
  async upsert(
    tx: Transaction,
    fact: { shopId: string; customerId: string; key: string; fact: string; sourceMessage: string },
  ): Promise<void> {
    await tx
      .insert(customerFacts)
      .values(fact)
      .onConflictDoUpdate({
        target: [customerFacts.customerId, customerFacts.key],
        set: {
          fact: sql`excluded.fact`,
          sourceMessage: sql`excluded.source_message`,
          updatedAt: sql`now()`,
        },
      });
  }

  list(tx: Transaction, customerId: string): Promise<CustomerFactRow[]> {
    return tx
      .select()
      .from(customerFacts)
      .where(eq(customerFacts.customerId, customerId))
      .orderBy(asc(customerFacts.key));
  }

  async deleteAll(tx: Transaction, customerId: string): Promise<void> {
    await tx.delete(customerFacts).where(eq(customerFacts.customerId, customerId));
  }
}
