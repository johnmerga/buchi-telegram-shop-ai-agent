import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  numeric,
  pgTable,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { products } from './catalog';
import { customers } from './customers';
import { shopIsolation } from './rls';
import { shops } from './shops';

/**
 * A customer's price talk about one negotiable product: the latest price the policy guard accepted,
 * which the customer buys at by confirming the order, and the concessions made to reach it. The
 * order that uses the price removes the row, so an agreed price holds only for that cart.
 */
export const negotiations = pgTable(
  'negotiations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull(),
    productId: uuid('product_id').notNull(),
    agreedPrice: numeric('agreed_price', { precision: 12, scale: 2 }).notNull(),
    concessionsMade: integer('concessions_made').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.customerId, t.shopId],
      foreignColumns: [customers.id, customers.shopId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.productId, t.shopId],
      foreignColumns: [products.id, products.shopId],
    }).onDelete('cascade'),
    unique('negotiations_customer_product_unique').on(t.customerId, t.productId),
    check('negotiations_concessions_not_negative', sql`${t.concessionsMade} >= 0`),
    shopIsolation(t.shopId),
  ],
);
