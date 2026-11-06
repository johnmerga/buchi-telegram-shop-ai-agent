import { bankChecks } from '@buchi/shared';
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  jsonb,
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
import { paymentProvider, shops } from './shops';

export const bankCheck = pgEnum('bank_check', bankChecks);

export const paymentDecision = pgEnum('payment_decision', [
  'approve',
  'reject',
  'review',
  'ask_difference',
  'ask_clearer',
]);

export const ownerPaymentDecision = pgEnum('owner_payment_decision', ['approved', 'rejected']);

export const riskSignalKind = pgEnum('risk_signal_kind', [
  'receipt_rejected',
  'bank_mismatch',
  'owner_rejected',
]);

/**
 * One payment screenshot and how Buchi judged it. The image stays on Telegram's servers, so only
 * its `file_id` is stored. `provider`, `tx_ref`, and `amount` repeat the readable receipt's key
 * fields so that later checks of the same order can query them.
 */
export const paymentProofs = pgTable(
  'payment_proofs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull(),
    /** Null for a payment proven by a link to the bank's own receipt page. */
    telegramFileId: text('telegram_file_id'),
    extraction: jsonb('extraction').$type<Record<string, unknown>>(),
    provider: paymentProvider('provider'),
    txRef: text('tx_ref'),
    amount: numeric('amount', { precision: 12, scale: 2 }),
    rules: jsonb('rules').$type<Record<string, string>>(),
    bankCheck: bankCheck('bank_check'),
    decision: paymentDecision('decision').notNull(),
    reasons: text('reasons')
      .array()
      .notNull()
      .default(sql`'{}'`),
    ownerDecision: ownerPaymentDecision('owner_decision'),
    /** When the customer reported a rejected screenshot, which puts it in the owner's review queue. */
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.orderId, t.shopId],
      foreignColumns: [orders.id, orders.shopId],
    }).onDelete('cascade'),
    index('payment_proofs_order_idx').on(t.orderId),
    shopIsolation(t.shopId),
  ],
);

/**
 * Platform-wide on purpose: rule R6 needs every shop's transaction references, and the unique
 * constraint lets only one order claim a reference, even when two shops claim it at once.
 */
export const paymentRefs = pgTable(
  'payment_refs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: paymentProvider('provider').notNull(),
    txRef: text('tx_ref').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('payment_refs_provider_tx_ref_unique').on(t.provider, t.txRef)],
);

/**
 * Platform-wide on purpose, so a payer's signals count across shops. The payer is stored only as
 * a keyed hash, so no shop can learn who another shop's customers are.
 */
export const riskSignals = pgTable(
  'risk_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payerHash: text('payer_hash').notNull(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    kind: riskSignalKind('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('risk_signals_payer_hash_idx').on(t.payerHash)],
);
