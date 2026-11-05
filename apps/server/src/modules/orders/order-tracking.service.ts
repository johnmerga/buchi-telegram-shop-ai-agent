import type { TrackedOrder } from '@buchi/shared';
import type { ShopsService } from '../shops/shops.service';
import type { OrderService } from './orders.service';

/** A customer's view of their own order. Other customers' orders are not found. */
export class OrderTrackingService {
  constructor(
    private readonly orders: Pick<OrderService, 'getForCustomer' | 'summary'>,
    private readonly shops: Pick<ShopsService, 'get'>,
  ) {}

  async track(telegramUserId: number, orderId: string): Promise<TrackedOrder> {
    const order = await this.orders.getForCustomer(telegramUserId, orderId);
    const [summary, shop] = await Promise.all([
      this.orders.summary(order.shopId, order.id),
      this.shops.get(order.shopId),
    ]);
    return {
      id: order.id,
      shopName: shop.name,
      status: order.status,
      deliveryType: order.deliveryType,
      total: order.total,
      deliveryFee: order.deliveryFee,
      paymentDeadline: order.paymentDeadline?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      lines: summary.lines,
    };
  }
}
