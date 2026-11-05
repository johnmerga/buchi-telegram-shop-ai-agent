import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { shopIsolation } from './rls';
import { shops } from './shops';

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** A shop's delivery prices and ranges. A shop without a row offers pickup only. */
export const deliverySettings = pgTable(
  'delivery_settings',
  {
    shopId: uuid('shop_id')
      .primaryKey()
      .references(() => shops.id, { onDelete: 'cascade' }),
    baseFee: money('base_fee').notNull(),
    ratePerKm: money('rate_per_km').notNull(),
    ratePerMinute: money('rate_per_minute').notNull(),
    freeRadiusKm: doublePrecision('free_radius_km').notNull(),
    standardRangeKm: doublePrecision('standard_range_km').notNull(),
    farRangeKm: doublePrecision('far_range_km').notNull(),
    farCap: money('far_cap').notNull(),
    saverDiscountPercent: integer('saver_discount_percent').notNull(),
    /** Addis Ababa times of day, such as "10:00", when Saver orders go out as grouped routes. */
    saverRunTimes: text('saver_run_times')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** The due time of the one pending Saver run timer, so a stale timer cannot run a second chain. */
    nextSaverRunAt: timestamp('next_saver_run_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'delivery_settings_ranges_grow',
      sql`0 <= ${t.freeRadiusKm} and ${t.freeRadiusKm} <= ${t.standardRangeKm} and ${t.standardRangeKm} <= ${t.farRangeKm}`,
    ),
    check('delivery_settings_saver_discount', sql`${t.saverDiscountPercent} between 0 and 90`),
    shopIsolation(t.shopId),
  ],
);

/**
 * Places that customers of a shop name instead of an address, such as "Edna Mall" in "Bole". Each
 * confirmed pin adds a confirmation, so the shop's own memory beats a fresh Nominatim search.
 */
export const landmarks = pgTable(
  'landmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** Normalized, so "Edna  mall" and "edna mall" are one landmark. */
    name: text('name').notNull(),
    area: text('area').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    confirmations: integer('confirmations').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('landmarks_shop_name_area_unique').on(t.shopId, t.name, t.area),
    shopIsolation(t.shopId),
  ],
);
