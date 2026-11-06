import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { DriverRow, DriversRepo } from './drivers.repo';

/** Runs `work` in each shop the user drives for, until one returns a result. */
export async function forDriver<T>(
  db: Database,
  drivers: Pick<DriversRepo, 'shopIdsOf' | 'byTelegramUser'>,
  telegramUserId: number,
  work: (tx: Transaction, driver: DriverRow) => Promise<T | undefined>,
): Promise<{ shopId: string; result: T } | undefined> {
  for (const shopId of await drivers.shopIdsOf(db, telegramUserId)) {
    const result = await withShop(db, shopId, async (tx) => {
      const driver = await drivers.byTelegramUser(tx, telegramUserId);
      return driver && work(tx, driver);
    });
    if (result !== undefined) return { shopId, result };
  }
  return undefined;
}
