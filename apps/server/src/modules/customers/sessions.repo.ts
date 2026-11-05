import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { customerSessions } from '../../db/schema';

export type CustomerSession = typeof customerSessions.$inferSelect;

/** Platform-wide: a session is read before the shop is known, so it uses no shop context. */
export class SessionsRepo {
  constructor(private readonly db: Database) {}

  async start(telegramUserId: number, shopId: string, productId: string | null): Promise<void> {
    await this.db
      .insert(customerSessions)
      .values({ telegramUserId, shopId, productId })
      .onConflictDoUpdate({
        target: customerSessions.telegramUserId,
        set: { shopId, productId, pendingVariantId: null, updatedAt: new Date() },
      });
  }

  async find(telegramUserId: number): Promise<CustomerSession | undefined> {
    const [row] = await this.db
      .select()
      .from(customerSessions)
      .where(eq(customerSessions.telegramUserId, telegramUserId));
    return row;
  }

  async setPendingVariant(telegramUserId: number, variantId: string | null): Promise<void> {
    await this.db
      .update(customerSessions)
      .set({ pendingVariantId: variantId, updatedAt: new Date() })
      .where(eq(customerSessions.telegramUserId, telegramUserId));
  }
}
