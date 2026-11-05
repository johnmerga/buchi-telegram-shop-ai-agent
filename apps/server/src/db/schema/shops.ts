import { paymentProviders } from '@buchi/shared';
import {
  bigint,
  doublePrecision,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { shopIsolation } from './rls';

export const shops = pgTable(
  'shops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    channelChatId: bigint('channel_chat_id', { mode: 'number' }).unique(),
    channelTitle: text('channel_title'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [shopIsolation(t.id)],
);

/** Telegram users who own a shop and can use the owner tools. */
export const shopMembers = pgTable(
  'shop_members',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    telegramUserId: bigint('telegram_user_id', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.telegramUserId] }), shopIsolation(t.shopId)],
);

export const paymentProvider = pgEnum('payment_provider', paymentProviders);

/** Accounts that customers pay into. Rule R4 checks every receipt's receiver against them. */
export const paymentAccounts = pgTable(
  'payment_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    provider: paymentProvider('provider').notNull(),
    accountName: text('account_name').notNull(),
    accountNumber: text('account_number').notNull(),
  },
  (t) => [shopIsolation(t.shopId)],
);
