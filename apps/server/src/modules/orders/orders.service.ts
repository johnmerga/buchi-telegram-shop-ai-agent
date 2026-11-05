import { Money, type DeliveryType, type OrderStatus } from '@buchi/shared';
import type { Database, Transaction } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { EventBus } from '../../shared/events';
import type { Coordinates } from '../delivery/location.domain';
import type { TimerService } from '../jobs/timers.service';
import { zoneOf } from '../delivery/zones.domain';
import { orderTimerKinds, paymentTimers } from './orders.deadlines.domain';
import {
  nextState,
  paidStatuses,
  unitPriceOf,
  type OrderEvent,
  type StockEffect,
} from './orders.domain';
import type {
  OrderActor,
  OrderEventRow,
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
    const { paymentDeadline, ...placed } = order;
    return this.insert(shopId, placed, { status: 'awaiting_payment', paymentDeadline }, actor);
  }

  /**
   * Reserves the stock of a far-area order while drivers price its delivery. The fee is set when
   * the customer accepts a price, and the stock returns to sale at `holdUntil` unless they do.
   */
  async createQuoting(
    shopId: string,
    order: Pick<NewOrder, 'customerId' | 'items'> & { destination: Coordinates },
    holdUntil: Date,
    actor: OrderActor,
  ): Promise<OrderRow> {
    const { destination, ...placed } = order;
    const delivery = { type: 'far' as const, fee: Money.zero, destination };
    return this.insert(shopId, { ...placed, delivery }, { status: 'quoting', holdUntil }, actor);
  }

  /** Sets the delivery fee a driver holds, and starts the payment deadline. */
  async acceptQuote(
    shopId: string,
    orderId: string,
    quote: { fee: Money; acceptedAt: Date; paymentDeadline: Date },
  ): Promise<OrderRow> {
    const { order, change } = await withShop(this.db, shopId, async (tx) => {
      const locked = await this.lock(tx, orderId);
      const total = Money.of(locked.itemsTotal).add(quote.fee);
      await this.repo.setQuotedFee(tx, orderId, {
        deliveryFee: quote.fee.toString(),
        total: total.toString(),
        paymentDeadline: quote.paymentDeadline,
      });
      const applied = await this.apply(
        tx,
        locked,
        'quote_accepted',
        'customer',
        'Accepted the delivery price',
      );
      const timers = paymentTimers(quote.acceptedAt, quote.paymentDeadline);
      await this.scheduleAll(tx, shopId, orderId, timers);
      return { order: await this.lock(tx, orderId), change: applied };
    });
    await this.events.publish('order.transitioned', { shopId, orderId, ...change });
    return order;
  }

  /**
   * Deletes the exact pins of orders that ended before `before`. Each order keeps its zone. Returns
   * how many orders lost their pin.
   */
  forgetPinsBefore(before: Date): Promise<number> {
    return this.repo.forgetPinsBefore(this.db, before);
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

  /** Expires an unpaid order only once its deadline has passed, which an extension may have moved. */
  async expireIfOverdue(shopId: string, orderId: string, now: Date): Promise<boolean> {
    const change = await withShop(this.db, shopId, async (tx) => {
      const order = await this.lock(tx, orderId);
      const overdue = order.paymentDeadline !== null && order.paymentDeadline <= now;
      if (order.status !== 'awaiting_payment' || !overdue) return null;
      return this.apply(tx, order, 'expired', 'system', 'Payment deadline passed');
    });
    if (!change) return false;

    await this.events.publish('order.transitioned', { shopId, orderId, ...change });
    return true;
  }

  /**
   * Moves an unpaid order's deadline and schedules its expiry at the new time. The expiry timer of
   * the old deadline finds the order not yet overdue and leaves it alone.
   */
  extendDeadline(shopId: string, orderId: string, minutes: number): Promise<Date> {
    return withShop(this.db, shopId, async (tx) => {
      const order = await this.lock(tx, orderId);
      if (order.status !== 'awaiting_payment' || order.paymentDeadline === null) {
        throw new AppError('CONFLICT', 'Only an order that waits for payment has a deadline');
      }
      const deadline = new Date(order.paymentDeadline.getTime() + minutes * 60_000);
      await this.repo.extendDeadline(tx, orderId, deadline);
      await this.timers.schedule(tx, orderTimerKinds.expire, orderId, shopId, deadline);
      return deadline;
    });
  }

  /** Takes an order off its trip, to wait for the next Saver run with the other paid orders. */
  async reschedule(shopId: string, orderId: string, reason: string): Promise<void> {
    const change = await withShop(this.db, shopId, async (tx) => {
      const order = await this.lock(tx, orderId);
      const moved = await this.apply(tx, order, 'rescheduled', 'agent', reason);
      // Saver, so that dispatch leaves the paid order for the run instead of offering it now.
      await this.repo.setDeliveryType(tx, orderId, 'saver');
      return moved;
    });

    await this.events.publish('order.transitioned', { shopId, orderId, ...change });
  }

  /**
   * Reserves one unit of another size of a delivered item, so the shop can swap it. Throws a
   * conflict when the size is sold out, the sizes belong to different products, or the order
   * already has an exchange.
   */
  async startExchange(
    shopId: string,
    exchange: { orderId: string; fromVariantId: string; toVariantId: string },
  ): Promise<void> {
    const { orderId, fromVariantId, toVariantId } = exchange;
    try {
      await withShop(this.db, shopId, async (tx) => {
        const order = await this.lock(tx, orderId);
        const items = await this.repo.items(tx, orderId);
        if (order.status !== 'delivered' || !items.some((i) => i.variantId === fromVariantId)) {
          throw new AppError('CONFLICT', 'Only a size on a delivered order can be exchanged');
        }
        const variants = await this.repo.sellableVariants(tx, [fromVariantId, toVariantId]);
        const [from, to] = [fromVariantId, toVariantId].map((id) =>
          variants.find((v) => v.variantId === id),
        );
        if (!from || !to || from.productId !== to.productId || from === to) {
          throw new AppError('CONFLICT', 'An exchange is for another size of the same product');
        }
        if (!(await this.repo.reserve(tx, toVariantId, 1))) {
          throw new AppError('CONFLICT', `Size ${to.size} is out of stock`);
        }
        await this.repo.insertExchange(tx, { shopId, ...exchange });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('CONFLICT', 'This order already has an exchange');
      }
      throw err;
    }
  }

  /** The order's status history, oldest first. */
  timeline(shopId: string, orderId: string): Promise<OrderEventRow[]> {
    return withShop(this.db, shopId, (tx) => this.repo.events(tx, orderId));
  }

  /** Units of a variant that customers paid for since `since`, for restock suggestions. */
  unitsSold(shopId: string, variantId: string, since: Date): Promise<number> {
    return withShop(this.db, shopId, (tx) =>
      this.repo.unitsSold(tx, variantId, since, paidStatuses),
    );
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
  private async priceLines(
    tx: Transaction,
    order: Pick<NewOrder, 'customerId' | 'items'>,
    variants: SellableVariant[],
  ) {
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

  /**
   * Reserves the stock and inserts the order with its first event and the timers that guard it:
   * the payment deadline, or the end of a far-area quote's hold.
   */
  private async insert(
    shopId: string,
    order: Omit<NewOrder, 'paymentDeadline'>,
    start:
      | { status: 'awaiting_payment'; paymentDeadline: Date }
      | { status: 'quoting'; holdUntil: Date },
    actor: OrderActor,
  ): Promise<OrderRow> {
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
        status: start.status,
        deliveryType: delivery.type,
        itemsTotal: itemsTotal.toString(),
        deliveryFee: deliveryFee.toString(),
        total: itemsTotal.add(deliveryFee).toString(),
        destination: delivery.type === 'pickup' ? null : delivery.destination,
        deliveryZone: delivery.type === 'pickup' ? null : zoneOf(delivery.destination),
        paymentDeadline: start.status === 'awaiting_payment' ? start.paymentDeadline : null,
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
      const timers =
        start.status === 'quoting'
          ? [{ kind: orderTimerKinds.quoteExpire, dueAt: start.holdUntil }]
          : paymentTimers(row.createdAt, start.paymentDeadline);
      await this.scheduleAll(tx, shopId, row.id, timers);
      return row;
    });

    await this.events.publish('order.created', { shopId, orderId: created.id });
    return created;
  }

  private async scheduleAll(
    tx: Transaction,
    shopId: string,
    orderId: string,
    timers: { kind: string; dueAt: Date }[],
  ): Promise<void> {
    for (const timer of timers) {
      await this.timers.schedule(tx, timer.kind, orderId, shopId, timer.dueAt);
    }
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
