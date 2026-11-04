import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { shops } from './shops';

export const timerStatus = pgEnum('timer_status', ['pending', 'running', 'done', 'failed']);

/**
 * Deadlines that must survive a restart. Platform-wide without row-level security, because the
 * tick claims due timers across every shop. `shop_id` tells a handler which shop to run in.
 */
export const timers = pgTable(
  'timers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    targetId: text('target_id').notNull(),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: timerStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('timers_status_due_at_idx').on(t.status, t.dueAt)],
);
