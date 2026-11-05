import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { customers } from '../../db/schema';

export type CustomerRow = typeof customers.$inferSelect;

export class CustomersRepo {
  /** Creates the customer on first contact and keeps their Telegram name current afterwards. */
  async upsert(
    tx: Transaction,
    customer: { shopId: string; telegramUserId: number; name: string },
  ): Promise<CustomerRow> {
    const [row] = await tx
      .insert(customers)
      .values(customer)
      .onConflictDoUpdate({
        target: [customers.shopId, customers.telegramUserId],
        set: { name: sql`excluded.name` },
      })
      .returning();
    if (!row) throw new Error('Upsert returned no customer');
    return row;
  }

  async setPhone(tx: Transaction, customerId: string, phone: string): Promise<void> {
    await tx.update(customers).set({ phone }).where(eq(customers.id, customerId));
  }
}
