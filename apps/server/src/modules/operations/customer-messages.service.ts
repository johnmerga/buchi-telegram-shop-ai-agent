import type { CustomersService } from '../customers/customers.service';
import type { OrderService } from '../orders/orders.service';
import type { ConversationService } from '../owner/conversations.service';
import type { Messenger } from '../owner/owner-notifier.service';
import { AppError } from '../../shared/errors';

interface Customer {
  telegramUserId: number;
  name: string;
}

export type MessageResult = 'sent' | 'owner_answering';

/**
 * Buchi's messages to a customer outside the sales chat. Nothing is sent while an owner answers
 * the customer, and every message joins the chat history, so the sales agent knows it was said.
 */
export class CustomerMessages {
  constructor(
    private readonly orders: Pick<OrderService, 'get'>,
    private readonly customers: Pick<CustomersService, 'get'>,
    private readonly conversations: Pick<ConversationService, 'humanConversation' | 'recordTurns'>,
    private readonly messenger: Pick<Messenger, 'send'>,
  ) {}

  async toOrderCustomer(shopId: string, orderId: string, text: string): Promise<MessageResult> {
    const order = await this.orders.get(shopId, orderId);
    return this.toCustomer(shopId, await this.customers.get(shopId, order.customerId), text);
  }

  async toCustomer(shopId: string, customer: Customer, text: string): Promise<MessageResult> {
    if (await this.conversations.humanConversation(shopId, customer.telegramUserId)) {
      return 'owner_answering';
    }
    try {
      await this.messenger.send(customer.telegramUserId, text, []);
    } catch {
      // The Telegram error holds the request with the text, so it is not passed on or logged.
      throw new AppError('CONFLICT', 'Telegram did not deliver the message to the customer.');
    }
    await this.conversations.recordTurns(shopId, customer, [{ role: 'buchi', text }]);
    return 'sent';
  }
}
