import { z } from 'zod';
import { coordinatesSchema } from './geo';
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

/** Addis Ababa times of day for Saver runs, such as `["10:00", "14:00"]`. An empty list stops them. */
export const saverRunTimesSchema = z.object({
  times: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour times such as "14:00".'))
    .max(6)
    .refine((times) => new Set(times).size === times.length, 'Each time can appear only once.'),
});
export type SaverRunTimes = z.infer<typeof saverRunTimesSchema>;

/** The settings screen's data. `settings` is null until the owner saves them: pickup only. */
export const deliverySettingsViewSchema = z.object({
  settings: deliverySettingsSchema.nullable(),
  saverRunTimes: saverRunTimesSchema.shape.times,
});
export type DeliverySettingsView = z.infer<typeof deliverySettingsViewSchema>;

const zoneBandSchema = z.object({
  factor: z.number().positive(),
  trips: z.number().int().min(0),
});

/**
 * One H3 zone of the learned time factors, with its hexagon's corners. A band is null when no
 * trips taught the zone a factor for that time of day yet.
 */
export const zoneFactorSchema = z.object({
  zone: z.string(),
  boundary: z.array(coordinatesSchema),
  peak: zoneBandSchema.nullable(),
  offPeak: zoneBandSchema.nullable(),
});
export type ZoneFactor = z.infer<typeof zoneFactorSchema>;

/** How far the trip-time estimates of the last 14 days were from the real trip times. */
export const estimateErrorSchema = z.object({
  trips: z.number().int().min(0),
  errorPercent: z.number().min(0),
});

export const zoneMapSchema = z.object({
  zones: z.array(zoneFactorSchema),
  estimateError: estimateErrorSchema.nullable(),
});
export type ZoneMap = z.infer<typeof zoneMapSchema>;
