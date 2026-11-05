import { Money, type DeliveryType, type OrderStatus } from '@buchi/shared';
import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { EventBus } from '../../shared/events';
import type { Coordinates } from '../delivery/location.domain';
import type { TimerService } from '../jobs/timers.service';
import { paymentTimers } from './orders.deadlines.domain';
import {
  nextState,
  paidStatuses,
  unitPriceOf,
  type OrderEvent,
  type StockEffect,
} from './orders.domain';
import type {
  OrderActor,
  OrderItemRow,
  OrderRow,
  OrdersRepo,
  OrderSummary,
  SellableVariant,
} from './orders.repo';

/** How the order reaches the customer. Every delivery has a fee, even a free one, and a pin. */
export type OrderDelivery =
  | { type: 'pickup' }
  | { type: Exclude<DeliveryType, 'pickup'>; fee: Money; destination: Coordinates };

export interface NewOrder {
  customerId: string;
  items: { variantId: string; quantity: number }[];
  delivery: OrderDelivery;
  paymentDeadline: Date;
}

export interface OrderWithItems extends OrderRow {
  items: OrderItemRow[];
}

/**
 * Prices that the sales agent agreed with a customer for negotiable products. They are read in
 * the order's own transaction, so the price an order uses is checked against the range it has then.
 */
export interface AgreedPrices {
  find(tx: Transaction, customerId: string, productId: string): Promise<Money | undefined>;
  /** Returns the agreed price and removes it, so it holds only for the order that uses it. */
  take(tx: Transaction, customerId: string, productId: string): Promise<Money | undefined>;
}

/** The only code that changes an order's status or the stock it reserves. */
export class OrderService {
  constructor(
    private readonly db: Database,
    private readonly repo: OrdersRepo,
    private readonly events: EventBus,
    private readonly timers: Pick<TimerService, 'schedule'>,
    private readonly agreedPrices: AgreedPrices,
  ) {}

  async create(shopId: string, order: NewOrder, actor: OrderActor): Promise<OrderRow> {
    if (order.items.length === 0) throw new AppError('VALIDATION_FAILED', 'An order needs items');

    const created = await withShop(this.db, shopId, async (tx) => {
      const variants = await this.repo.sellableVariants(
        tx,
        order.items.map((item) => item.variantId),
      );
      const lines = await this.priceLines(tx, order, variants);

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
      const { delivery } = order;
      const deliveryFee = delivery.type === 'pickup' ? Money.zero : delivery.fee;
      const row = await this.repo.insertOrder(tx, {
        shopId,
        customerId: order.customerId,
        status: 'awaiting_payment',
        deliveryType: delivery.type,
        itemsTotal: itemsTotal.toString(),
        deliveryFee: deliveryFee.toString(),
        total: itemsTotal.add(deliveryFee).toString(),
        destination: delivery.type === 'pickup' ? null : delivery.destination,
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
      for (const timer of paymentTimers(row.createdAt, order.paymentDeadline)) {
        await this.timers.schedule(tx, timer.kind, row.id, shopId, timer.dueAt);
      }
      return row;
    });

    await this.events.publish('order.created', { shopId, orderId: created.id });
    return created;
  }

  /**
   * The price this customer pays now for one unit of a variant, or `undefined` while a negotiable
   * product has no agreed price yet.
   */
  unitPrice(shopId: string, customerId: string, variantId: string): Promise<Money | undefined> {
    return withShop(this.db, shopId, async (tx) => {
      const [variant] = await this.repo.sellableVariants(tx, [variantId]);
      if (!variant?.active) throw notForSale();
      const agreed =
        variant.pricingMode === 'negotiable'
          ? await this.agreedPrices.find(tx, customerId, variant.productId)
          : undefined;
      const unit = unitPriceOf(variant, agreed);
      return unit.status === 'priced' ? unit.price : undefined;
    });
  }

  recentForCustomer(shopId: string, customerId: string, limit: number): Promise<OrderRow[]> {
    return withShop(this.db, shopId, (tx) => this.repo.recentForCustomer(tx, customerId, limit));
  }

  paidOrderCount(shopId: string, customerId: string): Promise<number> {
    return withShop(this.db, shopId, (tx) =>
      this.repo.countWithStatus(tx, customerId, paidStatuses),
    );
  }

  /** Validates the move, applies its stock effect, and records it, all in one transaction. */
  async transition(
    shopId: string,
    orderId: string,
    event: OrderEvent,
    actor: OrderActor,
    reason: string,
  ): Promise<OrderStatus> {
    const change = await withShop(this.db, shopId, async (tx) =>
      this.apply(tx, await this.lock(tx, orderId), event, actor, reason),
    );

    await this.events.publish('order.transitioned', { shopId, orderId, ...change });
    return change.to;
  }

  /**
   * Transitions the order only while it is still `expected`, and otherwise returns false.
   * Scheduled work uses it, because the customer may have paid or cancelled since it was scheduled.
   */
  async transitionIfStill(
    shopId: string,
    orderId: string,
    expected: OrderStatus,
    event: OrderEvent,
    actor: OrderActor,
    reason: string,
  ): Promise<boolean> {
    const change = await withShop(this.db, shopId, async (tx) => {
      const order = await this.lock(tx, orderId);
      return order.status === expected ? this.apply(tx, order, event, actor, reason) : null;
    });
    if (!change) return false;

    await this.events.publish('order.transitioned', { shopId, orderId, ...change });
    return true;
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

  /** Paid orders of one delivery type that wait for dispatch, oldest first. */
  paid(shopId: string, deliveryType: DeliveryType): Promise<OrderRow[]> {
    return withShop(this.db, shopId, (tx) => this.repo.paid(tx, deliveryType));
  }

  /** The shops that have paid orders of one delivery type waiting for dispatch. */
  shopsWithPaid(deliveryType: DeliveryType): Promise<string[]> {
    return this.repo.paidShopIds(this.db, deliveryType);
  }

  /** The customer's latest order in this shop that waits for a payment or has one being checked. */
  latestUnpaid(shopId: string, telegramUserId: number): Promise<OrderRow | undefined> {
    return withShop(this.db, shopId, (tx) => this.repo.latestUnpaid(tx, telegramUserId));
  }

  /** Finds an order of the customer with this Telegram user ID, in whichever shop it was placed. */
  async getForCustomer(telegramUserId: number, orderId: string): Promise<OrderWithItems> {
    const shopId = await this.repo.customerOrderShopId(this.db, orderId, telegramUserId);
    if (!shopId) throw new AppError('NOT_FOUND', 'Order not found');
    return this.get(shopId, orderId);
  }

  /**
   * Prices each line inside the order's transaction. A negotiable product's agreed price is taken
   * once per product and checked against its current range.
   */
  private async priceLines(tx: Transaction, order: NewOrder, variants: SellableVariant[]) {
    const agreed = new Map<string, Money | undefined>();
    const lines = [];
    for (const item of order.items) {
      const variant = variants.find((v) => v.variantId === item.variantId);
      if (!variant?.active) throw notForSale();
      if (variant.pricingMode === 'negotiable' && !agreed.has(variant.productId)) {
        const price = await this.agreedPrices.take(tx, order.customerId, variant.productId);
        agreed.set(variant.productId, price);
      }
      const unit = unitPriceOf(variant, agreed.get(variant.productId));
      if (unit.status !== 'priced') {
        throw new AppError('CONFLICT', `${variant.productTitle} needs an agreed price first`);
      }
      lines.push({
        ...item,
        unitPrice: unit.price.toString(),
        label: `${variant.productTitle} ${variant.size}`,
      });
    }
    return lines;
  }

  private async lock(tx: Transaction, orderId: string): Promise<OrderRow> {
    const order = await this.repo.lock(tx, orderId);
    if (!order) throw new AppError('NOT_FOUND', 'Order not found');
    return order;
  }

  /** Validates the move, applies its stock effect, and records it. */
  private async apply(
    tx: Transaction,
    order: OrderRow,
    event: OrderEvent,
    actor: OrderActor,
    reason: string,
  ): Promise<{ from: OrderStatus; to: OrderStatus }> {
    const next = nextState(order.status, event);
    if (!next.allowed) {
      throw new AppError('CONFLICT', `An order that is ${order.status} cannot be ${event}`);
    }
    await this.applyStock(tx, order.id, next.stock);
    await this.repo.setStatus(tx, order.id, next.to);
    await this.repo.insertEvent(tx, {
      shopId: order.shopId,
      orderId: order.id,
      fromStatus: order.status,
      toStatus: next.to,
      actor,
      reason,
    });
    return { from: order.status, to: next.to };
  }

  private async applyStock(tx: Transaction, orderId: string, effect: StockEffect): Promise<void> {
    if (effect === 'none') return;
    for (const item of await this.repo.items(tx, orderId)) {
      if (effect === 'release') await this.repo.release(tx, item.variantId, item.quantity);
      else await this.repo.commit(tx, item.variantId, item.quantity);
    }
  }
}

const notForSale = () => new AppError('NOT_FOUND', 'This product is not for sale');
