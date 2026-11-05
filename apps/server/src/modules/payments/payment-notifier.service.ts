import type { Logger } from 'pino';
import type { OrderService } from '../orders/orders.service';
import { ownerMessageHeader, type Button } from '../owner/owner.domain';
import type { Messenger, OwnerMessage } from '../owner/owner-notifier.service';
import type { ShopsService } from '../shops/shops.service';

/** Tells customers and a shop's owners about payment checks. */
export class PaymentNotifier {
  constructor(
    private readonly shops: Pick<ShopsService, 'get' | 'ownerIds'>,
    private readonly orders: Pick<OrderService, 'summary'>,
    private readonly messenger: Messenger,
    private readonly logger: Logger,
  ) {}

  async toCustomer(chatId: number, text: string): Promise<void> {
    await this.messenger.send(chatId, text, []);
  }

  /** One owner who blocked the bot does not stop the others. */
  async toOwners(
    shopId: string,
    orderId: string,
    message: OwnerMessage,
    buttons: Button[] = [],
  ): Promise<void> {
    const [shop, ownerIds, order] = await Promise.all([
      this.shops.get(shopId),
      this.shops.ownerIds(shopId),
      this.orders.summary(shopId, orderId),
    ]);
    const header = ownerMessageHeader(order.customerName, shop.name);
    for (const ownerId of ownerIds) {
      try {
        if ('text' in message) {
          await this.messenger.send(ownerId, `${header}\n${message.text}`, buttons);
        } else {
          const caption = [header, message.caption].filter(Boolean).join('\n');
          await this.messenger.copy(ownerId, message.copyOf, { caption, buttons });
        }
      } catch (err) {
        // Only the message: a Telegram error object also holds the request, with receipt details.
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.error({ shopId, reason }, 'payment notification failed');
      }
    }
  }
}
