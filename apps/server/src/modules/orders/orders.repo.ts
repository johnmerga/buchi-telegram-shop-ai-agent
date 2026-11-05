import type { DeliveryType, MoneyString, OrderStatus } from '@buchi/shared';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import {
  customers,
  orderEvents,
  orderItems,
  orders,
  products,
  productVariants,
} from '../../db/schema';

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type OrderActor = (typeof orderEvents.$inferInsert)['actor'];

export interface SellableVariant {
  variantId: string;
  productId: string;
  productTitle: string;
  size: string;
  pricingMode: (typeof products.$inferSelect)['pricingMode'];
  price: MoneyString;
  lowestPrice: MoneyString | null;
  active: boolean;
}

/** What an owner needs to know about a new order. */
export interface OrderSummary {
  orderId: string;
  total: MoneyString;
  customerTelegramUserId: number;
  customerName: string;
  lines: { title: string; size: string; quantity: number }[];
}

export class OrdersRepo {
  /**
   * Locks the products for sharing, so an owner cannot change a price range between the check of
   * an agreed price and the order that uses it.
   */
  sellableVariants(tx: Transaction, variantIds: string[]): Promise<SellableVariant[]> {
    return tx
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productTitle: products.title,
        size: productVariants.size,
        pricingMode: products.pricingMode,
        price: products.price,
        lowestPrice: products.lowestPrice,
        active: products.active,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, variantIds))
      .for('share', { of: products });
  }

  /** Reserves stock only if enough is unreserved, in one statement, so parallel orders cannot oversell. */
  async reserve(tx: Transaction, variantId: string, quantity: number): Promise<boolean> {
    const updated = await tx
      .update(productVariants)
      .set({ reserved: sql`${productVariants.reserved} + ${quantity}` })
      .where(
        and(
          eq(productVariants.id, variantId),
          gte(sql`${productVariants.stock} - ${productVariants.reserved}`, quantity),
        ),
      )
      .returning({ id: productVariants.id });
    return updated.length > 0;
  }

  async release(tx: Transaction, variantId: string, quantity: number): Promise<void> {
    await tx
      .update(productVariants)
      .set({ reserved: sql`${productVariants.reserved} - ${quantity}` })
      .where(eq(productVariants.id, variantId));
  }

  /** Turns a reservation into a sale: the units leave both the stock and the reservation. */
  async commit(tx: Transaction, variantId: string, quantity: number): Promise<void> {
    await tx
      .update(productVariants)
      .set({
        stock: sql`${productVariants.stock} - ${quantity}`,
        reserved: sql`${productVariants.reserved} - ${quantity}`,
      })
      .where(eq(productVariants.id, variantId));
  }

  async insertOrder(
    tx: Transaction,
    order: {
      shopId: string;
      customerId: string;
      status: OrderStatus;
      deliveryType: DeliveryType;
      itemsTotal: MoneyString;
      deliveryFee: MoneyString;
      total: MoneyString;
      destination: { latitude: number; longitude: number } | null;
      paymentDeadline: Date | null;
      items: { variantId: string; quantity: number; unitPrice: MoneyString }[];
    },
  ): Promise<OrderRow> {
    const { items, destination, ...values } = order;
    const [row] = await tx
      .insert(orders)
      .values({
        ...values,
        deliveryLatitude: destination?.latitude ?? null,
        deliveryLongitude: destination?.longitude ?? null,
      })
      .returning();
    if (!row) throw new Error('Insert returned no order');
    await tx
      .insert(orderItems)
      .values(items.map((item) => ({ ...item, shopId: order.shopId, orderId: row.id })));
    return row;
  }

  /** Locks the order row, so two transitions of one order run one after the other. */
  async lock(tx: Transaction, orderId: string): Promise<OrderRow | undefined> {
    const [row] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    return row;
  }

  async find(tx: Transaction, orderId: string): Promise<OrderRow | undefined> {
    const [row] = await tx.select().from(orders).where(eq(orders.id, orderId));
    return row;
  }

  async summary(tx: Transaction, orderId: string): Promise<OrderSummary | undefined> {
    const [order] = await tx
      .select({
        total: orders.total,
        customerTelegramUserId: customers.telegramUserId,
        customerName: customers.name,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.id, orderId));
    if (!order) return undefined;
    const lines = await tx
      .select({ title: products.title, size: productVariants.size, quantity: orderItems.quantity })
      .from(orderItems)
      .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(orderItems.orderId, orderId));
    return { orderId, ...order, lines };
  }

  /**
   * Looks across all shops, which row-level security blocks, through the `customer_order_shop_id`
   * database function. It returns the order's shop only to the customer who placed it.
   */
  async customerOrderShopId(
    db: Database,
    orderId: string,
    telegramUserId: number,
  ): Promise<string | null> {
    const [row] = await db.execute<{ shop_id: string | null }>(
      sql`select customer_order_shop_id(${orderId}, ${telegramUserId}) as shop_id`,
    );
    return row?.shop_id ?? null;
  }

  /** Paid orders of one delivery type, oldest first, that wait for dispatch. */
  paid(tx: Transaction, deliveryType: DeliveryType): Promise<OrderRow[]> {
    return tx
      .select()
      .from(orders)
      .where(and(eq(orders.status, 'paid'), eq(orders.deliveryType, deliveryType)))
      .orderBy(orders.createdAt);
  }

  /** Looks across all shops through the `paid_order_shop_ids` database function. */
  async paidShopIds(db: Database, deliveryType: DeliveryType): Promise<string[]> {
    const rows = await db.execute<{ shop_id: string }>(
      sql`select shop_id from paid_order_shop_ids(${deliveryType}) as shop_id`,
    );
    return rows.map((row) => row.shop_id);
  }

  /** The customer's latest order that waits for a payment or has one being checked. */
  async latestUnpaid(tx: Transaction, telegramUserId: number): Promise<OrderRow | undefined> {
    const [row] = await tx
      .select({ order: orders })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(
        and(
          eq(customers.telegramUserId, telegramUserId),
          inArray(orders.status, ['awaiting_payment', 'verifying', 'needs_review']),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    return row?.order;
  }

  recentForCustomer(tx: Transaction, customerId: string, limit: number): Promise<OrderRow[]> {
    return tx
      .select()
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt))
      .limit(limit);
  }

  async countWithStatus(
    tx: Transaction,
    customerId: string,
    statuses: readonly OrderStatus[],
  ): Promise<number> {
    const [row] = await tx
      .select({ orders: count() })
      .from(orders)
      .where(and(eq(orders.customerId, customerId), inArray(orders.status, [...statuses])));
    return row?.orders ?? 0;
  }

  items(tx: Transaction, orderId: string): Promise<OrderItemRow[]> {
    return tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  }

  async setStatus(tx: Transaction, orderId: string, status: OrderStatus): Promise<void> {
    await tx
      .update(orders)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(orders.id, orderId));
  }

  async insertEvent(
    tx: Transaction,
    event: {
      shopId: string;
      orderId: string;
      fromStatus: OrderStatus | null;
      toStatus: OrderStatus;
      actor: OrderActor;
      reason: string;
    },
  ): Promise<void> {
    await tx.insert(orderEvents).values(event);
  }
}
