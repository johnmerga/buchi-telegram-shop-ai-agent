import { eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
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

  async findByTelegramUser(
    tx: Transaction,
    telegramUserId: number,
  ): Promise<CustomerRow | undefined> {
    const [row] = await tx
      .select()
      .from(customers)
      .where(eq(customers.telegramUserId, telegramUserId));
    return row;
  }

  async find(tx: Transaction, customerId: string): Promise<CustomerRow | undefined> {
    const [row] = await tx.select().from(customers).where(eq(customers.id, customerId));
    return row;
  }

  async setDeliveryPin(
    tx: Transaction,
    customerId: string,
    pin: { latitude: number; longitude: number } | null,
  ): Promise<void> {
    await tx
      .update(customers)
      .set({
        deliveryLatitude: pin?.latitude ?? null,
        deliveryLongitude: pin?.longitude ?? null,
        deliveryPinAt: pin ? sql`now()` : null,
      })
      .where(eq(customers.id, customerId));
  }

  /** Looks across all shops through the `forget_pending_pins` database function. */
  async forgetPendingPinsBefore(db: Database, before: Date): Promise<number> {
    const [row] = await db.execute<{ forgotten: number }>(
      sql`select forget_pending_pins(${before.toISOString()}::timestamptz) as forgotten`,
    );
    return row?.forgotten ?? 0;
  }

  async telegramUserId(tx: Transaction, customerId: string): Promise<number | undefined> {
    const [row] = await tx
      .select({ telegramUserId: customers.telegramUserId })
      .from(customers)
      .where(eq(customers.id, customerId));
    return row?.telegramUserId;
  }
}
