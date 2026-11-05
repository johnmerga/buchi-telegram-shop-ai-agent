import type { DeliverySettings } from '@buchi/shared';
import { and, eq, sql } from 'drizzle-orm';
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

  async saverRunTimes(tx: Transaction): Promise<string[] | undefined> {
    const [row] = await tx.select({ times: deliverySettings.saverRunTimes }).from(deliverySettings);
    return row?.times;
  }

  /** Returns false when the shop has no delivery settings to add run times to. */
  async setSaverSchedule(
    tx: Transaction,
    shopId: string,
    schedule: { times: string[]; nextRunAt: Date | null },
  ): Promise<boolean> {
    const updated = await tx
      .update(deliverySettings)
      .set({
        saverRunTimes: schedule.times,
        nextSaverRunAt: schedule.nextRunAt,
        updatedAt: sql`now()`,
      })
      .where(eq(deliverySettings.shopId, shopId))
      .returning({ shopId: deliverySettings.shopId });
    return updated.length > 0;
  }

  /** Moves the next run on only if it is still `dueAt`, so only the current timer claims a run. */
  async advanceSaverRun(
    tx: Transaction,
    shopId: string,
    dueAt: Date,
    nextRunAt: Date | null,
  ): Promise<boolean> {
    const updated = await tx
      .update(deliverySettings)
      .set({ nextSaverRunAt: nextRunAt })
      .where(and(eq(deliverySettings.shopId, shopId), eq(deliverySettings.nextSaverRunAt, dueAt)))
      .returning({ shopId: deliverySettings.shopId });
    return updated.length > 0;
  }
}
