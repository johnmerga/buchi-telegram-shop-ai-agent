import type { Update } from 'grammy/types';
import { bigint, index, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const telegramUpdateStatus = pgEnum('telegram_update_status', [
  'pending',
  'processing',
  'done',
  'failed',
]);

/** Every webhook update, stored before processing so that retries and restarts never lose or repeat one. */
export const telegramUpdates = pgTable(
  'telegram_updates',
  {
    updateId: bigint('update_id', { mode: 'number' }).primaryKey(),
    payload: jsonb('payload').$type<Update>().notNull(),
    status: telegramUpdateStatus('status').notNull().default('pending'),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [index('telegram_updates_status_idx').on(t.status, t.updateId)],
);
