import { Money, type MoneyString, type OrderStatus } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { CustomersService } from '../customers/customers.service';
import type { SpecialOffers } from '../drivers/special-offers.service';
import type { CheckoutService } from '../orders/checkout.service';
import type { OrderService } from '../orders/orders.service';
import type { Messenger } from '../owner/owner-notifier.service';
import { noPrice, pickupButton, priceFound } from './far-quote-messages.domain';
import type { FarQuoteRow, FarQuotesRepo } from './far-quotes.repo';
import { farQuoteCallbackData } from './far-quotes.schemas';

export type ConfirmResult = { status: 'accepted'; instructions: string } | { status: 'closed' };

/** Statuses of a quote that has not ended yet. */
const open = ['estimating', 'awaiting_owner', 'offered', 'held'] as const;
/** Order statuses in which a far order is never delivered. */
const closedStatuses: readonly OrderStatus[] = ['cancelled', 'expired', 'payment_rejected'];

/**
 * How a far quote ends: a driver holds the price, then the customer confirms, declines, or lets
 * the 20-minute hold run out. Each outcome stays on the quote as evidence for the next estimate.
 */
export class FarQuoteOutcomes {
  constructor(
    private readonly db: Database,
    private readonly repo: FarQuotesRepo,
    private readonly orders: Pick<OrderService, 'get' | 'getForCustomer' | 'transitionIfStill'>,
    private readonly checkout: Pick<CheckoutService, 'acceptFarQuote'>,
    private readonly customers: Pick<CustomersService, 'telegramUserId'>,
    private readonly offers: Pick<SpecialOffers, 'withdraw'>,
    private readonly messenger: Pick<Messenger, 'send'>,
  ) {}

  /** A driver holds the price, so the customer now sees it with the new total. */
  async driverHeld(event: {
    shopId: string;
    orderId: string;
    price: MoneyString;
    raises: number;
  }): Promise<void> {
    const { shopId, orderId, price, raises } = event;
    const held = await withShop(this.db, shopId, async (tx) => {
      const quote = await this.repo.byOrder(tx, orderId);
      return (
        quote &&
        this.repo.move(tx, quote.id, ['offered'], { status: 'held', heldPrice: price, raises })
      );
    });
    if (!held) return;
    const order = await this.orders.get(shopId, orderId);
    if (order.status !== 'quoting') return;
    const chatId = await this.customers.telegramUserId(shopId, order.customerId);
    const total = Money.of(order.itemsTotal).add(Money.of(price)).toString();
    await this.messenger.send(
      chatId,
      priceFound({ orderId, itemsTotal: order.itemsTotal, fee: price, total }),
      [
        { text: '✅ አረጋግጥ / Confirm', data: farQuoteCallbackData('confirm', orderId) },
        { text: 'አልፈልግም / Decline', data: farQuoteCallbackData('decline', orderId) },
      ],
    );
  }

  /** The customer accepts the held price: the order waits for payment, and the driver waits too. */
  async confirm(telegramUserId: number, orderId: string): Promise<ConfirmResult> {
    const { shopId } = await this.orders.getForCustomer(telegramUserId, orderId);
    const quote = await this.quoteOf(shopId, orderId);
    if (quote?.status !== 'held' || quote.heldPrice === null) return { status: 'closed' };
    const instructions = await this.checkout.acceptFarQuote(
      shopId,
      orderId,
      Money.of(quote.heldPrice),
    );
    await this.move(shopId, quote.id, ['held'], { status: 'accepted' });
    return { status: 'accepted', instructions };
  }

  /** Returns false when the quote had already ended. */
  async decline(telegramUserId: number, orderId: string): Promise<boolean> {
    const { shopId } = await this.orders.getForCustomer(telegramUserId, orderId);
    const quote = await this.quoteOf(shopId, orderId);
    if (!quote || !(await this.move(shopId, quote.id, ['held'], { status: 'declined' }))) {
      return false;
    }
    return this.orders.transitionIfStill(
      shopId,
      orderId,
      'quoting',
      'cancelled',
      'customer',
      'Declined the delivery price',
    );
  }

  /** The quote hold timer: without an accepted price in 20 minutes, the stock returns to sale. */
  async holdExpired(timer: { targetId: string; shopId: string | null }): Promise<void> {
    const { shopId, targetId: orderId } = timer;
    if (shopId === null) throw new Error('A quote hold timer needs a shop');
    const expired = await this.orders.transitionIfStill(
      shopId,
      orderId,
      'quoting',
      'expired',
      'system',
      'No delivery price was accepted within 20 minutes',
    );
    if (!expired) return;
    const quote = await this.quoteOf(shopId, orderId);
    if (quote) await this.move(shopId, quote.id, open, { status: 'expired' });
    const order = await this.orders.get(shopId, orderId);
    const chatId = await this.customers.telegramUserId(shopId, order.customerId);
    await this.messenger.send(chatId, noPrice(orderId, quote?.status === 'held'), [pickupButton]);
  }

  /**
   * Releases the driver once a far order can no longer be delivered: declined, out of time,
   * unpaid after the customer confirmed, or closed by a rejected payment.
   */
  async orderTransitioned(event: { shopId: string; orderId: string; to: OrderStatus }) {
    if (!closedStatuses.includes(event.to)) return;
    await this.offers.withdraw(event.shopId, event.orderId);
  }

  private quoteOf(shopId: string, orderId: string): Promise<FarQuoteRow | undefined> {
    return withShop(this.db, shopId, (tx) => this.repo.byOrder(tx, orderId));
  }

  private move(
    shopId: string,
    quoteId: string,
    from: readonly FarQuoteRow['status'][],
    change: Parameters<FarQuotesRepo['move']>[3],
  ): Promise<FarQuoteRow | undefined> {
    return withShop(this.db, shopId, (tx) => this.repo.move(tx, quoteId, from, change));
  }
}
