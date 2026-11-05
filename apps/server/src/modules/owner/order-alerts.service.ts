import type { OrderService } from '../orders/orders.service';
import type { ConversationService } from './conversations.service';
import { orderAlert } from './owner.domain';
import type { OwnerNotifier } from './owner-notifier.service';

/** Tells a shop's owners about each new order, with a **Take over** button for its customer. */
export class OrderAlerts {
  constructor(
    private readonly orders: Pick<OrderService, 'summary'>,
    private readonly conversations: ConversationService,
    private readonly notifier: OwnerNotifier,
  ) {}

  async orderCreated(event: { shopId: string; orderId: string }): Promise<void> {
    const order = await this.orders.summary(event.shopId, event.orderId);
    const conversation = await this.conversations.open(event.shopId, {
      telegramUserId: order.customerTelegramUserId,
      name: order.customerName,
    });
    await this.notifier.notify(conversation, { text: orderAlert(order) });
  }
}
