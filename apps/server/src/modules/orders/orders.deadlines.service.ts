import type { MoneyString } from '@buchi/shared';
import type { CustomersService } from '../customers/customers.service';
import { minutesLeft } from './orders.deadlines.domain';
import type { OrderService } from './orders.service';

/** Tells a customer, in their private chat with the bot, what happened to their unpaid order. */
export interface OrderNotifier {
  paymentReminder(
    chatId: number,
    reminder: { orderId: string; total: MoneyString; minutesLeft: number },
  ): Promise<void>;
  orderExpired(chatId: number, orderId: string): Promise<void>;
}

/** The part of a timer that names its order: the target is the order ID, in the timer's shop. */
interface OrderTimer {
  targetId: string;
  shopId: string | null;
}

/** Reminds customers about unpaid orders, and expires the orders at their deadline. */
export class PaymentDeadlineService {
  constructor(
    private readonly orders: OrderService,
    private readonly customers: CustomersService,
    private readonly notifier: OrderNotifier,
    private readonly now: () => Date,
  ) {}

  async remind(timer: OrderTimer): Promise<void> {
    const shopId = shopOf(timer);
    const order = await this.orders.get(shopId, timer.targetId);
    if (order.status !== 'awaiting_payment' || order.paymentDeadline === null) return;
    const chatId = await this.customers.telegramUserId(shopId, order.customerId);
    await this.notifier.paymentReminder(chatId, {
      orderId: order.id,
      total: order.total,
      minutesLeft: minutesLeft(order.paymentDeadline, this.now()),
    });
  }

  async expire(timer: OrderTimer): Promise<void> {
    const shopId = shopOf(timer);
    const expired = await this.orders.transitionIfStill(
      shopId,
      timer.targetId,
      'awaiting_payment',
      'expired',
      'system',
      'Payment deadline passed',
    );
    if (!expired) return;
    const order = await this.orders.get(shopId, timer.targetId);
    const chatId = await this.customers.telegramUserId(shopId, order.customerId);
    await this.notifier.orderExpired(chatId, order.id);
  }
}

function shopOf(timer: OrderTimer): string {
  if (timer.shopId === null) throw new Error('An order timer has no shop');
  return timer.shopId;
}
