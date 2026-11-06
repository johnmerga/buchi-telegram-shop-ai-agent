import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { shopIsolation } from './rls';
import { shops } from './shops';

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

const shopId = () =>
  uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' });

/**
 * A shop's driver. The owner adds a Telegram username, and the row is linked to the Telegram user
 * ID, which never changes, when that user opens the one-time invite link.
 */
export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    /** Lowercase and without the "@", because Telegram usernames ignore case. */
    username: text('username').notNull(),
    telegramUserId: bigint('telegram_user_id', { mode: 'number' }),
    name: text('name'),
    phone: text('phone'),
    available: boolean('available').notNull().default(false),
    /** Only a SHA-256 hash, so a database leak cannot be used to link someone else's account. */
    inviteTokenHash: text('invite_token_hash').unique(),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('drivers_shop_username_unique').on(t.shopId, t.username),
    unique('drivers_shop_telegram_unique').on(t.shopId, t.telegramUserId),
    unique('drivers_id_shop_unique').on(t.id, t.shopId),
    check(
      'drivers_invite_complete',
      sql`(${t.inviteTokenHash} is null) = (${t.inviteExpiresAt} is null)`,
    ),
    shopIsolation(t.shopId),
  ],
);

export const deliveryJobStatus = pgEnum('delivery_job_status', [
  'offered',
  'assigned',
  'picked_up',
  'delivered',
]);

/** One trip for a driver: an Express or free delivery, or a Saver route with several stops. */
export const deliveryJobs = pgTable(
  'delivery_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    driverId: uuid('driver_id'),
    status: deliveryJobStatus('status').notNull().default('offered'),
    /**
     * A far-area job, offered under **Special offers**. Its first accept only holds it while the
     * customer confirms and pays, and its price rises every five minutes without an accept.
     */
    special: boolean('special').notNull().default(false),
    /** What the driver gets: the formula payout plus any bonus the owner added. */
    payout: money('payout').notNull(),
    /**
     * What separate trips to every stop would have paid. It equals the payout for one stop, and
     * shows what grouping a Saver route saves.
     */
    separateTripsPayout: money('separate_trips_payout').notNull(),
    /** Road distance from the shop through every stop, which drivers see before they accept. */
    routeMeters: integer('route_meters').notNull(),
    /** Routing minutes times the zone time factors, from pickup to the last stop. */
    estimatedMinutes: integer('estimated_minutes').notNull(),
    /** From pickup to the last delivery. Task 5.5 learns the time factors from it. */
    actualMinutes: integer('actual_minutes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    /**
     * The driver's latest Live Location point and when it came. It is kept only while the trip is
     * on the road, so **Delivered** can use it, and cleared when the trip ends or sharing stops.
     */
    liveLatitude: doublePrecision('live_latitude'),
    liveLongitude: doublePrecision('live_longitude'),
    liveAt: timestamp('live_at', { withTimezone: true }),
    /** When the driver's sharing ends. Empty while it is shared until stopped. */
    liveUntil: timestamp('live_until', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.driverId, t.shopId],
      foreignColumns: [drivers.id, drivers.shopId],
    }),
    unique('delivery_jobs_id_shop_unique').on(t.id, t.shopId),
    check(
      'delivery_jobs_driver_assigned',
      sql`(${t.status} = 'offered') = (${t.driverId} is null)`,
    ),
    shopIsolation(t.shopId),
  ],
);

/** How the customer confirmed a delivery. `assumed` means no answer within two hours. */
export const deliveryReceipt = pgEnum('delivery_receipt', ['received', 'problem', 'assumed']);

/** An order on a job, in the order the driver visits them. Each order is on one job only. */
export const jobStops = pgTable(
  'job_stops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    jobId: uuid('job_id').notNull(),
    orderId: uuid('order_id').notNull().unique(),
    position: integer('position').notNull(),
    /**
     * The routing time of the leg that ends at this stop, and that time scaled by the zone's time
     * factor. Delivered legs teach the time factors. Empty on stops planned before Task 5.5.
     */
    routingSeconds: integer('routing_seconds'),
    expectedSeconds: integer('expected_seconds'),
    /** Set when the driver taps **Delivered** in the chat and Buchi waits for their location. */
    locationRequestedAt: timestamp('location_requested_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    /** Only the distance is kept, never the driver's coordinates. */
    metersFromPin: integer('meters_from_pin'),
    needsReview: boolean('needs_review').notNull().default(false),
    receipt: deliveryReceipt('receipt'),
    receiptAt: timestamp('receipt_at', { withTimezone: true }),
    /** The live map in the customer's chat that follows the driver, until this stop is delivered. */
    liveChatId: bigint('live_chat_id', { mode: 'number' }),
    liveMessageId: integer('live_message_id'),
  },
  (t) => [
    foreignKey({
      columns: [t.jobId, t.shopId],
      foreignColumns: [deliveryJobs.id, deliveryJobs.shopId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.orderId, t.shopId],
      foreignColumns: [orders.id, orders.shopId],
    }),
    unique('job_stops_job_position_unique').on(t.jobId, t.position),
    shopIsolation(t.shopId),
  ],
);

/** `held` is for far-area jobs, where one driver holds the price until the customer pays. */
export const jobOfferStatus = pgEnum('job_offer_status', ['open', 'held', 'taken', 'expired']);

/**
 * A job offered to the shop's drivers at one price. An owner bonus expires the offer and opens a
 * new one at the next raise step. The first driver to accept takes it.
 */
export const jobOffers = pgTable(
  'job_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    jobId: uuid('job_id').notNull(),
    price: money('price').notNull(),
    raiseStep: integer('raise_step').notNull().default(0),
    status: jobOfferStatus('status').notNull().default('open'),
    takenByDriverId: uuid('taken_by_driver_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.jobId, t.shopId],
      foreignColumns: [deliveryJobs.id, deliveryJobs.shopId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.takenByDriverId, t.shopId],
      foreignColumns: [drivers.id, drivers.shopId],
    }),
    unique('job_offers_id_shop_unique').on(t.id, t.shopId),
    unique('job_offers_job_step_unique').on(t.jobId, t.raiseStep),
    check(
      'job_offers_taken_by',
      sql`(${t.status} in ('taken', 'held')) = (${t.takenByDriverId} is not null)`,
    ),
    shopIsolation(t.shopId),
  ],
);

/** The chat message that carries an offer to one driver, so it can change once the offer closes. */
export const offerMessages = pgTable(
  'offer_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    offerId: uuid('offer_id').notNull(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    messageId: integer('message_id').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.offerId, t.shopId],
      foreignColumns: [jobOffers.id, jobOffers.shopId],
    }).onDelete('cascade'),
    index('offer_messages_offer_idx').on(t.offerId),
    shopIsolation(t.shopId),
  ],
);
