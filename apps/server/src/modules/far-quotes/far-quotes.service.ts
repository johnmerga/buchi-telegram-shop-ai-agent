import { Money } from '@buchi/shared';
import type { Logger } from 'pino';
import type { FarPriceEstimator } from '../../ai/agents/far-price/far-price-estimator';
import type { PolicyGuard } from '../../ai/guard/policy-guard.service';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { DeliveryService } from '../delivery/delivery.service';
import { zoneOf } from '../delivery/zones.domain';
import type { CustomersService } from '../customers/customers.service';
import { point } from '../drivers/dispatch.domain';
import type { DeliveryOwnerAlerts } from '../drivers/owner-alerts.service';
import type { SpecialOffers } from '../drivers/special-offers.service';
import type { OrderService } from '../orders/orders.service';
import type { Messenger } from '../owner/owner-notifier.service';
import type { FarQuoteEvidence } from './far-quote-evidence.service';
import { ownerApproval, pickupButton, pickupOffered } from './far-quote-messages.domain';
import { assertOfferable, raisedPrice } from './far-quotes.domain';
import type { FarQuoteRow, FarQuotesRepo } from './far-quotes.repo';
import { farQuoteCallbackData } from './far-quotes.schemas';

export type OwnerAnswer = 'approved' | 'pickup' | 'closed' | 'not_found';

/**
 * Prices a far-area delivery: the first price from the operations agent or the statistics, the
 * owner's answer above the cap, and the 10% raises that never pass the cap.
 */
export class FarQuoteService {
  constructor(
    private readonly db: Database,
    private readonly repo: FarQuotesRepo,
    private readonly orders: Pick<OrderService, 'get' | 'transitionIfStill'>,
    private readonly customers: Pick<CustomersService, 'telegramUserId'>,
    private readonly delivery: Pick<DeliveryService, 'farTrip'>,
    private readonly evidence: Pick<FarQuoteEvidence, 'build'>,
    private readonly estimator: Pick<FarPriceEstimator, 'estimate'>,
    private readonly guard: Pick<PolicyGuard, 'answerOwner'>,
    private readonly offers: Pick<SpecialOffers, 'open' | 'openOffer' | 'raise'>,
    private readonly alerts: Pick<DeliveryOwnerAlerts, 'send'>,
    private readonly messenger: Pick<Messenger, 'send'>,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  /**
   * Estimates the first price for an order in `quoting` and offers it to the drivers, or asks the
   * owner when it is above the cap.
   */
  async start(shopId: string, orderId: string): Promise<void> {
    const order = await this.orders.get(shopId, orderId);
    const destination = point(order.deliveryLatitude, order.deliveryLongitude);
    const trip = destination && (await this.delivery.farTrip(shopId, destination));
    const [leg] = trip?.legs ?? [];
    if (!destination || !trip || !leg) {
      throw new Error('A quoting order is no longer in the far range');
    }
    const quote = await withShop(this.db, shopId, (tx) =>
      this.repo.insert(tx, {
        shopId,
        orderId,
        zone: zoneOf(destination),
        routeMeters: trip.meters,
        routingSeconds: leg.routingSeconds,
        expectedSeconds: leg.expectedSeconds,
        formulaPayout: trip.payout.toString(),
        cap: trip.cap.toString(),
      }),
    );
    const estimate = await this.estimator.estimate({
      shopId,
      evidence: await this.evidence.build(shopId, destination, trip),
      cap: trip.cap,
    });
    const priced = await this.move(shopId, quote.id, ['estimating'], {
      status: estimate.needsOwner ? 'awaiting_owner' : 'offered',
      proposedPrice: estimate.price.toString(),
      source: estimate.source,
      decisionId: estimate.decisionId,
    });
    if (!priced) return;
    this.logger.info({ shopId, quoteId: quote.id, source: estimate.source }, 'far quote priced');
    if (!estimate.needsOwner) {
      await this.offer(shopId, priced, estimate.price, false);
      return;
    }
    await this.alerts.send(
      shopId,
      ownerApproval({
        orderId,
        routeMeters: trip.meters,
        formulaPayout: priced.formulaPayout,
        cap: priced.cap,
        price: estimate.price.toString(),
        reason: estimate.reason,
      }),
      [
        { text: '✅ Approve once', data: farQuoteCallbackData('approve', quote.id) },
        { text: '🏪 Offer pickup', data: farQuoteCallbackData('pickup', quote.id) },
      ],
    );
  }

  /**
   * The owner's answer to a price above the cap. **Approve once** offers that price to the
   * drivers without raises; **Offer pickup** cancels the quote and offers the customer pickup.
   */
  async ownerAnswered(
    owner: { telegramUserId: number; shopIds: string[] },
    quoteId: string,
    approved: boolean,
  ): Promise<OwnerAnswer> {
    for (const shopId of owner.shopIds) {
      const quote = await withShop(this.db, shopId, (tx) => this.repo.find(tx, quoteId));
      if (!quote) continue;
      if (quote.status !== 'awaiting_owner' || quote.decisionId === null) return 'closed';
      const answered = await this.guard.answerOwner(shopId, quote.decisionId, {
        status: approved ? 'approved' : 'declined',
        decidedBy: owner.telegramUserId,
        decidedAt: this.now(),
      });
      if (!answered) return 'closed';
      const moved = await this.move(shopId, quoteId, ['awaiting_owner'], {
        status: approved ? 'offered' : 'pickup',
      });
      if (!moved?.proposedPrice || moved.orderId === null) return 'closed';
      if (approved) {
        await this.offer(shopId, moved, Money.of(moved.proposedPrice), true);
        return 'approved';
      }
      await this.offerPickup(shopId, moved.orderId);
      return 'pickup';
    }
    return 'not_found';
  }

  /** The raise timer handler: an offer nobody accepted for five minutes rises by 10%. */
  async raiseDue(timer: { targetId: string; shopId: string | null }): Promise<void> {
    const { shopId, targetId: offerId } = timer;
    if (shopId === null) throw new Error('A special offer timer needs a shop');
    const open = await this.offers.openOffer(shopId, offerId);
    if (!open) return;
    const quote = await withShop(this.db, shopId, (tx) => this.repo.byOrder(tx, open.orderId));
    if (quote?.status !== 'offered') return;
    const cap = Money.of(quote.cap);
    const next = raisedPrice(Money.of(open.offer.price), cap);
    if (!next) return;
    assertOfferable(next, cap, false);
    await this.offers.raise(shopId, offerId, next, raisedPrice(next, cap) !== undefined);
  }

  /** The one place a far-area price goes to drivers, so the cap check cannot be skipped. */
  private async offer(
    shopId: string,
    quote: FarQuoteRow,
    price: Money,
    ownerApproved: boolean,
  ): Promise<void> {
    const cap = Money.of(quote.cap);
    assertOfferable(price, cap, ownerApproved);
    if (quote.orderId === null) throw new Error('A synthetic quote cannot be offered');
    await this.offers.open(
      shopId,
      {
        stop: {
          orderId: quote.orderId,
          routingSeconds: quote.routingSeconds,
          expectedSeconds: quote.expectedSeconds,
        },
        routeMeters: quote.routeMeters,
        estimatedMinutes: Math.round(quote.expectedSeconds / 60),
      },
      price,
      // An owner-approved price is already above the cap, so it never rises.
      !ownerApproved && raisedPrice(price, cap) !== undefined,
    );
  }

  private async offerPickup(shopId: string, orderId: string): Promise<void> {
    const cancelled = await this.orders.transitionIfStill(
      shopId,
      orderId,
      'quoting',
      'cancelled',
      'owner',
      'The owner offered pickup instead of a far delivery',
    );
    if (!cancelled) return;
    const order = await this.orders.get(shopId, orderId);
    const chatId = await this.customers.telegramUserId(shopId, order.customerId);
    await this.messenger.send(chatId, pickupOffered(orderId), [pickupButton]);
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
