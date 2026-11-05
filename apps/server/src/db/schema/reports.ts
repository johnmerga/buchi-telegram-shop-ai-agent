import { sql } from 'drizzle-orm';
import {
  date,
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

const shopId = () =>
  uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' });

/** The Google spreadsheet that a shop's ledger goes to. A shop without a row keeps no ledger. */
export const sheetLedgers = pgTable(
  'sheet_ledgers',
  {
    shopId: shopId().primaryKey(),
    spreadsheetId: text('spreadsheet_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [shopIsolation(t.shopId)],
);

/** The spreadsheet tab a row belongs to: one row per paid order, or one per day. */
export const ledgerTab = pgEnum('ledger_tab', ['Sales', 'Daily']);

export const ledgerRowStatus = pgEnum('ledger_row_status', ['pending', 'sent']);

/**
 * The durable queue of rows for the shop's spreadsheet. `key` is the row's first cell too, so a
 * retry can see in the sheet whether an earlier attempt already arrived.
 */
export const ledgerRows = pgTable(
  'ledger_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    key: text('key').notNull(),
    tab: ledgerTab('tab').notNull(),
    cells: jsonb('cells').$type<(string | number)[]>().notNull(),
    status: ledgerRowStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** When the next attempt may claim the row. A claim moves it on, which doubles as a lease. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ledger_rows_shop_key_unique').on(t.shopId, t.key),
    index('ledger_rows_due_idx')
      .on(t.status, t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    shopIsolation(t.shopId),
  ],
);

export const dailyReportKind = pgEnum('daily_report_kind', ['evening_summary', 'morning_brief']);

/** One row per shop, report, and Addis Ababa day, so a second cron call sends nothing twice. */
export const dailyReportRuns = pgTable(
  'daily_report_runs',
  {
    shopId: shopId(),
    kind: dailyReportKind('kind').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.kind, t.day] }), shopIsolation(t.shopId)],
);
