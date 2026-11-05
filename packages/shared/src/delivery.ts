import { z } from 'zod';
import { moneySchema } from './money';

const kilometres = z.number().min(0).max(200);

/**
 * An owner's delivery prices and ranges. Road distance up to `freeRadiusKm` is free, up to
 * `standardRangeKm` gets Express and Saver, up to `farRangeKm` needs a price from the drivers, and
 * beyond it the customer picks up at the shop.
 */
export const deliverySettingsSchema = z
  .object({
    baseFee: moneySchema,
    ratePerKm: moneySchema,
    ratePerMinute: moneySchema,
    freeRadiusKm: kilometres,
    standardRangeKm: kilometres,
    farRangeKm: kilometres,
    /** The most a far-area delivery may cost without the owner's approval. */
    farCap: moneySchema,
    saverDiscountPercent: z.number().int().min(0).max(90),
  })
  .refine((s) => s.freeRadiusKm <= s.standardRangeKm, {
    path: ['standardRangeKm'],
    message: 'The standard range must reach at least as far as the free radius.',
  })
  .refine((s) => s.standardRangeKm <= s.farRangeKm, {
    path: ['farRangeKm'],
    message: 'The far range must reach at least as far as the standard range.',
  });
export type DeliverySettings = z.infer<typeof deliverySettingsSchema>;
