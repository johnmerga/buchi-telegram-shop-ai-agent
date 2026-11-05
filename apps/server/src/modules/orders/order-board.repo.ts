import type { OrderLine } from '@buchi/shared';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { customers, orderItems, orders, productVariants, products } from '../../db/schema';

export type BoardOrderRow = Pick<
  typeof orders.$inferSelect,
  | 'id'
  | 'status'
  | 'deliveryType'
  | 'total'
  | 'deliveryFee'
  | 'paymentDeadline'
  | 'createdAt'
  | 'updatedAt'
> & { customerName: string };

/** Read-only queries for the owner's order board. */
export class OrderBoardRepo {
  recent(tx: Transaction, limit: number): Promise<BoardOrderRow[]> {
    return tx
      .select({
        id: orders.id,
        status: orders.status,
        deliveryType: orders.deliveryType,
        total: orders.total,
        deliveryFee: orders.deliveryFee,
        paymentDeadline: orders.paymentDeadline,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customerName: customers.name,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .orderBy(desc(orders.createdAt))
      .limit(limit);
  }

  lines(tx: Transaction, orderIds: string[]): Promise<(OrderLine & { orderId: string })[]> {
    return tx
      .select({
        orderId: orderItems.orderId,
        title: products.title,
        size: productVariants.size,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(orderItems.orderId, orderIds));
  }
}
