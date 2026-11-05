import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { agentDecisions } from './agents';
import { orders } from './orders';
import { shopIsolation } from './rls';
import { shops } from './shops';

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

const shopId = () =>
  uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' });

/**
 * `estimating` until a price exists, `awaiting_owner` for a price above the cap, `offered` to
 * drivers, `held` by one driver while the customer decides, and then one outcome.
 */
export const farQuoteStatus = pgEnum('far_quote_status', [
  'estimating',
  'awaiting_owner',
  'offered',
  'held',
  'accepted',
  'declined',
  'expired',
  'pickup',
]);

/** Who set the first price: the operations agent, or the statistics when Gemini is unavailable. */
export const farQuoteSource = pgEnum('far_quote_source', ['agent', 'statistics']);

/**
 * A far-area delivery priced by the shop's drivers. Every outcome stays as evidence for the next
 * estimate: the formula payout, the first price, the price a driver held, and the raises it took.
 */
export const farQuotes = pgTable(
  'far_quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    orderId: uuid('order_id').unique(),
    /** The destination's H3 resolution-7 zone. The order's exact pin is deleted after a week. */
    zone: text('zone').notNull(),
    routeMeters: integer('route_meters').notNull(),
    routingSeconds: integer('routing_seconds').notNull(),
    /** Routing seconds times the zone's time factor when the quote started. */
    expectedSeconds: integer('expected_seconds').notNull(),
    formulaPayout: money('formula_payout').notNull(),
    /** The owner's cap when the quote started. */
    cap: money('cap').notNull(),
    status: farQuoteStatus('status').notNull().default('estimating'),
    proposedPrice: money('proposed_price'),
    source: farQuoteSource('source'),
    /** The policy guard's record of the first price, which the owner answers above the cap. */
    decisionId: uuid('decision_id').references(() => agentDecisions.id),
    heldPrice: money('held_price'),
    raises: integer('raises').notNull().default(0),
    synthetic: boolean('synthetic').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.orderId, t.shopId],
      foreignColumns: [orders.id, orders.shopId],
    }).onDelete('cascade'),
    check('far_quotes_order_unless_synthetic', sql`${t.synthetic} or ${t.orderId} is not null`),
    check(
      'far_quotes_priced',
      sql`(${t.status} = 'estimating') = (${t.proposedPrice} is null) and (${t.proposedPrice} is null) = (${t.source} is null)`,
    ),
    shopIsolation(t.shopId),
  ],
);

/**
 * How much more than the formula payout this shop's drivers accept for far trips to a zone. Zones
 * are H3 resolution-6 cells and the shop as a whole, because each shop has its own drivers.
 */
export const zoneAcceptanceFactors = pgTable(
  'zone_acceptance_factors',
  {
    shopId: shopId(),
    zone: text('zone').notNull(),
    factor: doublePrecision('factor').notNull(),
    trips: integer('trips').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.zone] }), shopIsolation(t.shopId)],
);
