import { deliveryTypeSchema, orderStatusSchema } from '@buchi/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { productVariants } from './catalog';
import { customers } from './customers';
import { shopIsolation } from './rls';
import { shops } from './shops';

export const orderStatus = pgEnum('order_status', orderStatusSchema.options);

export const deliveryType = pgEnum('delivery_type', deliveryTypeSchema.options);

export const orderActor = pgEnum('order_actor', ['customer', 'owner', 'agent', 'system']);

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

const shopId = () =>
  uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' });

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    customerId: uuid('customer_id').notNull(),
    status: orderStatus('status').notNull(),
    deliveryType: deliveryType('delivery_type').notNull(),
    itemsTotal: money('items_total').notNull(),
    deliveryFee: money('delivery_fee').notNull().default('0'),
    total: money('total').notNull(),
    paymentDeadline: timestamp('payment_deadline', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.customerId, t.shopId],
      foreignColumns: [customers.id, customers.shopId],
    }),
    unique('orders_id_shop_unique').on(t.id, t.shopId),
    check('orders_total_adds_up', sql`${t.total} = ${t.itemsTotal} + ${t.deliveryFee}`),
    shopIsolation(t.shopId),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    orderId: uuid('order_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: money('unit_price').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.orderId, t.shopId],
      foreignColumns: [orders.id, orders.shopId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.variantId, t.shopId],
      foreignColumns: [productVariants.id, productVariants.shopId],
    }),
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
    shopIsolation(t.shopId),
  ],
);

/** The audit history of every order: each status change, who made it, and why. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    orderId: uuid('order_id').notNull(),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    actor: orderActor('actor').notNull(),
    reason: text('reason').notNull(),
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
