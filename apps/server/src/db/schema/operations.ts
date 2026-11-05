import { foreignKey, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { shopIsolation } from './rls';
import { shops } from './shops';

export const deliveryProblemKind = pgEnum('delivery_problem_kind', [
  'wrong_size',
  'damaged',
  'other',
]);

/**
 * What a customer reported after tapping **Problem** on a delivered order. One report per order,
 * so a repeated tap cannot wake the operations agent twice.
 */
export const deliveryProblems = pgTable(
  'delivery_problems',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull().unique(),
    kind: deliveryProblemKind('kind').notNull(),
    /** For a wrong size: the size the customer chose, set once. */
    wantedSize: text('wanted_size'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.orderId, t.shopId],
      foreignColumns: [orders.id, orders.shopId],
    }).onDelete('cascade'),
    shopIsolation(t.shopId),
  ],
);
