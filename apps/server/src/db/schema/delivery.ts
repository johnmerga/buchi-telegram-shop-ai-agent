import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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

/** Addis Ababa traffic differs at rush hour, so each zone learns one time factor per band. */
export const timeBand = pgEnum('time_band', ['peak', 'off_peak']);

/**
 * One road leg of a finished delivery: how long the routing service said it takes and how long it
 * took. Platform-wide, because traffic is the same for every shop. It holds only the destination's
 * H3 resolution-7 zone (about 5 km²), never a pin or a shop, so it holds no personal data.
 */
export const tripLegs = pgTable(
  'trip_legs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    zone: text('zone').notNull(),
    band: timeBand('band').notNull(),
    routingSeconds: integer('routing_seconds').notNull(),
    /** Routing seconds times the time factor that the payout used. */
    expectedSeconds: integer('expected_seconds').notNull(),
    actualSeconds: integer('actual_seconds').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** Seeded demo data, so the zone map shows learning before real trips exist. */
    synthetic: boolean('synthetic').notNull().default(false),
  },
  (t) => [
    check('trip_legs_positive_seconds', sql`${t.routingSeconds} > 0 and ${t.actualSeconds} > 0`),
    index('trip_legs_started_at_idx').on(t.startedAt),
  ],
);

/**
 * The learned time factor of a zone in a time band. Zones are H3 resolution-7 cells, their
 * resolution-6 parents, and the whole city. Platform-wide like the legs it is learned from.
 */
export const zoneTimeFactors = pgTable(
  'zone_time_factors',
  {
    zone: text('zone').notNull(),
    band: timeBand('band').notNull(),
    factor: doublePrecision('factor').notNull(),
    trips: integer('trips').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.zone, t.band] })],
);

/**
 * Recent reports about an area, such as a driver's note about a closed road. The operations agent
 * reads them as evidence for far-area prices.
 */
export const areaNotes = pgTable(
  'area_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** The H3 resolution-7 zone the note is about. */
    zone: text('zone').notNull(),
    note: text('note').notNull(),
    synthetic: boolean('synthetic').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('area_notes_zone_idx').on(t.shopId, t.zone), shopIsolation(t.shopId)],
);
