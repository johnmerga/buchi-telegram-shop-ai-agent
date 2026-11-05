import { Money, type DeliveryType, type OrderStatus } from '@buchi/shared';
import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { EventBus } from '../../shared/events';
import { nextState, type OrderEvent, type StockEffect } from './orders.domain';
import type { OrderActor, OrderItemRow, OrderRow, OrdersRepo, OrderSummary } from './orders.repo';

export interface NewOrder {
  customerId: string;
  items: { variantId: string; quantity: number }[];
  deliveryType: DeliveryType;
  paymentDeadline: Date;
}

export interface OrderWithItems extends OrderRow {
  items: OrderItemRow[];
}

/** The only code that changes an order's status or the stock it reserves. */
export class OrderService {
  constructor(
    private readonly db: Database,
    private readonly repo: OrdersRepo,
    private readonly events: EventBus,
  ) {}

  async create(shopId: string, order: NewOrder, actor: OrderActor): Promise<OrderRow> {
    if (order.items.length === 0) throw new AppError('VALIDATION_FAILED', 'An order needs items');

    const created = await withShop(this.db, shopId, async (tx) => {
      const variants = await this.repo.sellableVariants(
        tx,
        order.items.map((item) => item.variantId),
      );
      const lines = order.items.map((item) => {
        const variant = variants.find((v) => v.variantId === item.variantId);
        if (!variant?.active) throw new AppError('NOT_FOUND', 'This product is not for sale');
        // Negotiable products get their price from the sales agent, which Task 4.2 adds.
        if (variant.pricingMode !== 'fixed') {
          throw new AppError('CONFLICT', `${variant.productTitle} needs an agreed price`);
        }
        return {
          ...item,
          unitPrice: variant.price,
          label: `${variant.productTitle} ${variant.size}`,
        };
      });

      // A fixed order of reservations keeps two orders for the same items from deadlocking.
      for (const line of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        if (!(await this.repo.reserve(tx, line.variantId, line.quantity))) {
          throw new AppError('CONFLICT', `${line.label} is out of stock`);
        }
      }

      const itemsTotal = lines.reduce(
        (sum, line) => sum.add(Money.of(line.unitPrice).times(line.quantity)),
        Money.zero,
      );
      const row = await this.repo.insertOrder(tx, {
        shopId,
        customerId: order.customerId,
        status: 'awaiting_payment',
        deliveryType: order.deliveryType,
        itemsTotal: itemsTotal.toString(),
        total: itemsTotal.toString(),
        paymentDeadline: order.paymentDeadline,
        items: lines.map(({ variantId, quantity, unitPrice }) => ({
          variantId,
          quantity,
          unitPrice,
        })),
      });
      await this.repo.insertEvent(tx, {
        shopId,
        orderId: row.id,
        fromStatus: null,
        toStatus: row.status,
        actor,
        reason: 'Order created',
      });
      return row;
    });

    await this.events.publish('order.created', { shopId, orderId: created.id });
    return created;
  }

  /** Validates the move, applies its stock effect, and records it, all in one transaction. */
  async transition(
    shopId: string,
    orderId: string,
    event: OrderEvent,
    actor: OrderActor,
    reason: string,
  ): Promise<OrderStatus> {
    const change = await withShop(this.db, shopId, async (tx) => {
      const order = await this.repo.lock(tx, orderId);
      if (!order) throw new AppError('NOT_FOUND', 'Order not found');
      const next = nextState(order.status, event);
      if (!next.allowed) {
        throw new AppError('CONFLICT', `An order that is ${order.status} cannot be ${event}`);
      }
      await this.applyStock(tx, orderId, next.stock);
      await this.repo.setStatus(tx, orderId, next.to);
      await this.repo.insertEvent(tx, {
        shopId,
        orderId,
        fromStatus: order.status,
        toStatus: next.to,
        actor,
        reason,
      });
      return { from: order.status, to: next.to };
    });

    await this.events.publish('order.transitioned', { shopId, orderId, ...change });
    return change.to;
  }

  get(shopId: string, orderId: string): Promise<OrderWithItems> {
    return withShop(this.db, shopId, async (tx) => {
      const order = await this.repo.find(tx, orderId);
      if (!order) throw new AppError('NOT_FOUND', 'Order not found');
      return { ...order, items: await this.repo.items(tx, orderId) };
    });
  }

  summary(shopId: string, orderId: string): Promise<OrderSummary> {
    return withShop(this.db, shopId, async (tx) => {
      const summary = await this.repo.summary(tx, orderId);
      if (!summary) throw new AppError('NOT_FOUND', 'Order not found');
      return summary;
    });
  }

  private async applyStock(tx: Transaction, orderId: string, effect: StockEffect): Promise<void> {
    if (effect === 'none') return;
    for (const item of await this.repo.items(tx, orderId)) {
      if (effect === 'release') await this.repo.release(tx, item.variantId, item.quantity);
      else await this.repo.commit(tx, item.variantId, item.quantity);
    }
  }
}
