import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('customers_shop_telegram_unique').on(t.shopId, t.telegramUserId),
    unique('customers_id_shop_unique').on(t.id, t.shopId),
    check(
      'customers_delivery_pin_complete',
      sql`(${t.deliveryLatitude} is null) = (${t.deliveryLongitude} is null)`,
    ),
    shopIsolation(t.shopId),
  ],
);
