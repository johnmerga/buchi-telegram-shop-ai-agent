import { date, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { shopIsolation } from './rls';
import { shops } from './shops';

/** One row per shop and week, claimed before the weekly suggestions run, so they run once. */
export const weeklySuggestionRuns = pgTable(
  'weekly_suggestion_runs',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** The Monday of the week, in Addis Ababa. */
    week: date('week').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.week] }), shopIsolation(t.shopId)],
);
