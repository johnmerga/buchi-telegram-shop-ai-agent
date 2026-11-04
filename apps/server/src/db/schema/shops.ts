import { bigint, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { shopIsolation } from './rls';

export const shops = pgTable(
  'shops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
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
