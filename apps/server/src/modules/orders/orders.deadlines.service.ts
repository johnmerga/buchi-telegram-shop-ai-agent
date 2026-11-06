import type { CustomersService } from '../customers/customers.service';
import type { OrderService } from './orders.service';

/** Tells a customer, in their private chat with the bot, that their unpaid order expired. */
export interface OrderNotifier {
  orderExpired(chatId: number, orderId: string): Promise<void>;
}

/** The part of a timer that names its order: the target is the order ID, in the timer's shop. */
interface OrderTimer {
  targetId: string;
  shopId: string | null;
}

/** Expires unpaid orders at their deadline, which returns their stock to sale. */
export class PaymentDeadlineService {
  constructor(
    private readonly orders: OrderService,
    private readonly customers: CustomersService,
    private readonly notifier: OrderNotifier,
    private readonly now: () => Date,
  ) {}

  async expire(timer: OrderTimer): Promise<void> {
    const shopId = shopOf(timer);
    const expired = await this.orders.expireIfOverdue(shopId, timer.targetId, this.now());
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
