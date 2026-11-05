import {
  type AnyPgColumn,
  boolean,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { PRODUCT_EMBEDDING_DIMENSIONS, productVariants } from './catalog';
import { customers } from './customers';
import { shopIsolation } from './rls';
import { shops } from './shops';

const shopId = () =>
  uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' });

const sameShopCustomer = (t: { customerId: AnyPgColumn; shopId: AnyPgColumn }) =>
  foreignKey({
    columns: [t.customerId, t.shopId],
    foreignColumns: [customers.id, customers.shopId],
  }).onDelete('cascade');

/**
 * A product a customer asked for that the shop does not have, described from their photo. The
 * owner's weekly report counts these as unmet demand.
 */
export const demandSignals = pgTable(
  'demand_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    customerId: uuid('customer_id').notNull(),
    description: text('description').notNull(),
    /** The customer tapped **Notify me**. */
    notifyRequested: boolean('notify_requested').notNull().default(false),
    /** The description's embedding, compared with each new product's for **Notify me**. */
    embedding: vector('embedding', { dimensions: PRODUCT_EMBEDDING_DIMENSIONS }),
    /** When the customer was told about a similar product. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [sameShopCustomer(t), shopIsolation(t.shopId)],
);

/** Customers waiting for a sold-out size, in the order they joined. */
export const waitlist = pgTable(
  'waitlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    customerId: uuid('customer_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (t) => [
    sameShopCustomer(t),
    foreignKey({
      columns: [t.variantId, t.shopId],
      foreignColumns: [productVariants.id, productVariants.shopId],
    }).onDelete('cascade'),
    unique('waitlist_variant_customer_unique').on(t.variantId, t.customerId),
    shopIsolation(t.shopId),
  ],
);
