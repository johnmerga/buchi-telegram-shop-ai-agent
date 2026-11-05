import { sql } from 'drizzle-orm';
import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
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

export const conversationMode = pgEnum('conversation_mode', ['agent', 'human']);

/** One message of the chat as the sales agent remembers it. */
export interface ConversationTurn {
  role: 'customer' | 'buchi';
  text: string;
  /** ISO time, so turns older than the agent's memory window can be dropped. */
  at: string;
}

/**
 * A customer's private chat with Buchi about one shop. In `human` mode Buchi stays quiet and
 * relays the chat to the shop's owners until `hand_back_at`, which each owner reply moves on.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    customerTelegramUserId: bigint('customer_telegram_user_id', { mode: 'number' }).notNull(),
    customerName: text('customer_name').notNull(),
    mode: conversationMode('mode').notNull().default('agent'),
    handBackAt: timestamp('hand_back_at', { withTimezone: true }),
    /**
     * The last few text messages between the customer and the sales agent. Tool calls are not
     * kept: the agent asks its tools again, so stale prices and stock never come back from here.
     */
    recentTurns: jsonb('recent_turns')
      .$type<ConversationTurn[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('conversations_shop_customer_unique').on(t.shopId, t.customerTelegramUserId),
    unique('conversations_id_shop_unique').on(t.id, t.shopId),
    shopIsolation(t.shopId),
  ],
);

/**
 * Messages that Buchi sent to an owner about a conversation. A Telegram reply carries only the
 * replied-to message's chat and ID, so this maps it back to the customer.
 */
export const relayedMessages = pgTable(
  'relayed_messages',
  {
    ownerChatId: bigint('owner_chat_id', { mode: 'number' }).notNull(),
    messageId: integer('message_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerChatId, t.messageId] }),
    foreignKey({
      columns: [t.conversationId, t.shopId],
      foreignColumns: [conversations.id, conversations.shopId],
    }).onDelete('cascade'),
    shopIsolation(t.shopId),
  ],
);

/**
 * When a customer's message reached Telegram and when Buchi's answer to it did, both by Telegram's
 * clock, for the median first-reply time in **Insights**. Holds no message text and no customer.
 */
export const replyTimes = pgTable(
  'reply_times',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    repliedAt: timestamp('replied_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('reply_times_shop_received_idx').on(t.shopId, t.receivedAt),
    shopIsolation(t.shopId),
  ],
);
