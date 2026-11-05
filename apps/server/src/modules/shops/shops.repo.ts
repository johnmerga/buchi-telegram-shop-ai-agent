import type { PaymentAccount, ShopLocation } from '@buchi/shared';
import { eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { paymentAccounts, shopMembers, shops } from '../../db/schema';

export type ShopRow = typeof shops.$inferSelect;

export class ShopsRepo {
  constructor(private readonly db: Database) {}

  /**
   * Looks across all shops, which row-level security blocks, through the `owner_shop_ids`
   * database function. It returns only shop IDs.
   */
  async ownedShopIds(telegramUserId: number): Promise<string[]> {
    const rows = await this.db.execute<{ shop_id: string }>(
      sql`select shop_id from owner_shop_ids(${telegramUserId}) as shop_id`,
    );
    return rows.map((row) => row.shop_id);
  }

  async insert(
    tx: Transaction,
    shop: { id: string; name: string; ownerId: number },
  ): Promise<void> {
    await tx.insert(shops).values({ id: shop.id, name: shop.name });
    await tx.insert(shopMembers).values({ shopId: shop.id, telegramUserId: shop.ownerId });
  }

  async find(tx: Transaction, shopId: string): Promise<ShopRow | undefined> {
    const [shop] = await tx.select().from(shops).where(eq(shops.id, shopId));
    return shop;
  }

  async setLocation(tx: Transaction, shopId: string, location: ShopLocation): Promise<void> {
    await tx.update(shops).set(location).where(eq(shops.id, shopId));
  }

  async setChannel(
    tx: Transaction,
    shopId: string,
    channel: { chatId: number; title: string },
  ): Promise<void> {
    await tx
      .update(shops)
      .set({ channelChatId: channel.chatId, channelTitle: channel.title })
      .where(eq(shops.id, shopId));
  }

  async listPaymentAccounts(tx: Transaction): Promise<PaymentAccount[]> {
    return tx
      .select({
        provider: paymentAccounts.provider,
        accountName: paymentAccounts.accountName,
        accountNumber: paymentAccounts.accountNumber,
      })
      .from(paymentAccounts);
  }

  async replacePaymentAccounts(
    tx: Transaction,
    shopId: string,
    accounts: PaymentAccount[],
  ): Promise<void> {
    await tx.delete(paymentAccounts).where(eq(paymentAccounts.shopId, shopId));
    await tx.insert(paymentAccounts).values(accounts.map((account) => ({ ...account, shopId })));
  }
}
