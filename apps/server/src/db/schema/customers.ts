import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { shopIsolation } from './rls';
import { shops } from './shops';

/** A Telegram user as a customer of one shop. The same person has one row per shop. */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    telegramUserId: bigint('telegram_user_id', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    /** The pin for the order the customer is placing. It moves to the order once it is placed. */
    deliveryLatitude: doublePrecision('delivery_latitude'),
    deliveryLongitude: doublePrecision('delivery_longitude'),
    /** A pin left behind by an unfinished checkout is deleted a week after this. */
    deliveryPinAt: timestamp('delivery_pin_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('customers_shop_telegram_unique').on(t.shopId, t.telegramUserId),
    unique('customers_id_shop_unique').on(t.id, t.shopId),
    check(
      'customers_delivery_pin_complete',
      sql`(${t.deliveryLatitude} is null) = (${t.deliveryLongitude} is null) and (${t.deliveryLatitude} is null) = (${t.deliveryPinAt} is null)`,
    ),
    shopIsolation(t.shopId),
  ],
);

/**
 * Stable facts a customer told the sales agent, such as their shoe size, with the message they
 * came from. One fact per key, so a new size replaces the old one.
 */
export const customerFacts = pgTable(
  'customer_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull(),
    key: text('key').notNull(),
    fact: text('fact').notNull(),
    sourceMessage: text('source_message').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.customerId, t.shopId],
      foreignColumns: [customers.id, customers.shopId],
    }).onDelete('cascade'),
    unique('customer_facts_customer_key_unique').on(t.customerId, t.key),
    shopIsolation(t.shopId),
  ],
);
