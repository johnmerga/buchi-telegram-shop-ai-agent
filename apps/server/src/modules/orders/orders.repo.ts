import type { DeliveryType, MoneyString, OrderStatus } from '@buchi/shared';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
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
  productTitle: string;
  size: string;
  pricingMode: (typeof products.$inferSelect)['pricingMode'];
  price: MoneyString;
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
  sellableVariants(tx: Transaction, variantIds: string[]): Promise<SellableVariant[]> {
    return tx
      .select({
        variantId: productVariants.id,
        productTitle: products.title,
        size: productVariants.size,
        pricingMode: products.pricingMode,
        price: products.price,
        active: products.active,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, variantIds));
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
      total: MoneyString;
      paymentDeadline: Date | null;
      items: { variantId: string; quantity: number; unitPrice: MoneyString }[];
    },
  ): Promise<OrderRow> {
    const { items, ...values } = order;
    const [row] = await tx.insert(orders).values(values).returning();
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
