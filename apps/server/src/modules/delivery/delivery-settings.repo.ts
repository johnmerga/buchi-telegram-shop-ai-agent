import type { DeliverySettings } from '@buchi/shared';
import { sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { deliverySettings } from '../../db/schema';

export class DeliverySettingsRepo {
  async find(tx: Transaction): Promise<DeliverySettings | undefined> {
    const [row] = await tx
      .select({
        baseFee: deliverySettings.baseFee,
        ratePerKm: deliverySettings.ratePerKm,
        ratePerMinute: deliverySettings.ratePerMinute,
        freeRadiusKm: deliverySettings.freeRadiusKm,
        standardRangeKm: deliverySettings.standardRangeKm,
        farRangeKm: deliverySettings.farRangeKm,
        farCap: deliverySettings.farCap,
        saverDiscountPercent: deliverySettings.saverDiscountPercent,
      })
      .from(deliverySettings);
    return row;
  }

  async save(tx: Transaction, shopId: string, settings: DeliverySettings): Promise<void> {
    await tx
      .insert(deliverySettings)
      .values({ shopId, ...settings })
      .onConflictDoUpdate({
        target: deliverySettings.shopId,
        set: { ...settings, updatedAt: sql`now()` },
      });
  }
}
