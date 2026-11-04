import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client';

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
}
