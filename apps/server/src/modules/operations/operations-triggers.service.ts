import type { OperationsAgent } from '../../ai/agents/operations/operations-agent';
import type { SituationBuilder } from '../../ai/agents/operations/situation-builder';
import type { TripDetails } from '../drivers/trip-details.service';
import type { OrderService } from '../orders/orders.service';
import type { ConversationService } from '../owner/conversations.service';
import { isNearDeadline, reachesWaitlistThreshold } from './operations.domain';

interface Customer {
  telegramUserId: number;
  name: string;
}

/** The part of a timer that names its target in a shop. */
interface ShopTimer {
  targetId: string;
  shopId: string | null;
}

/**
 * The events that wake the operations agent. Each one builds its situation and runs the agent
 * once. Only two are timers, both saved with the change they guard: a trip running late and an
 * offer nobody accepted. Nothing else runs the agent on a schedule.
 */
export class OperationsTriggers {
  constructor(
    private readonly agent: Pick<OperationsAgent, 'handle'>,
    private readonly situations: Pick<
      SituationBuilder,
      'paymentDeadline' | 'driverReport' | 'deliveryLate' | 'noDriverAccepted' | 'waitlist'
    >,
    private readonly orders: Pick<OrderService, 'latestUnpaid'>,
    private readonly trips: Pick<TripDetails, 'activeTripOf' | 'trip' | 'openOffer'>,
    private readonly conversations: Pick<ConversationService, 'recordTurns'>,
    private readonly now: () => Date,
  ) {}

  /**
   * A customer's message while their order waits for payment close to the deadline. Returns
   * false when the agent took no action, so the sales agent answers the message instead.
   */
  async customerMessage(shopId: string, customer: Customer, text: string): Promise<boolean> {
    const order = await this.orders.latestUnpaid(shopId, customer.telegramUserId);
    if (
      order?.status !== 'awaiting_payment' ||
      !isNearDeadline(order.paymentDeadline, this.now())
    ) {
      return false;
    }
    const situation = await this.situations.paymentDeadline(shopId, order.id, customer, text);
    // Recorded first, so the chat history keeps the customer's words before Buchi's answer.
    await this.conversations.recordTurns(shopId, customer, [{ role: 'customer', text }]);
    return (await this.agent.handle(situation)) === 'acted';
  }

  /** A driver's message while they are on a trip. Returns false when they are not on one. */
  async driverMessage(telegramUserId: number, text: string): Promise<boolean> {
    const active = await this.trips.activeTripOf(telegramUserId);
    if (!active) return false;
    await this.agent.handle(await this.situations.driverReport(active.shopId, active.trip, text));
    return true;
  }

  /** The late-trip timer handler. A trip that ended meanwhile needs nothing. */
  async deliveryLate(timer: ShopTimer): Promise<void> {
    const shopId = shopOf(timer);
    const trip = await this.trips.trip(shopId, timer.targetId);
    if (trip?.status !== 'picked_up') return;
    await this.agent.handle(await this.situations.deliveryLate(shopId, trip));
  }

  /** The unanswered-offer timer handler. An offer a driver took meanwhile needs nothing. */
  async offerUnanswered(timer: ShopTimer): Promise<void> {
    const shopId = shopOf(timer);
    const offer = await this.trips.openOffer(shopId, timer.targetId);
    if (!offer) return;
    await this.agent.handle(await this.situations.noDriverAccepted(shopId, offer));
  }

  /** The `waitlist.joined` subscriber. */
  async waitlistJoined(event: { shopId: string; variantId: string; waiting: number }) {
    if (!reachesWaitlistThreshold(event.waiting)) return;
    const situation = await this.situations.waitlist(event.shopId, event.variantId, event.waiting);
    if (situation) await this.agent.handle(situation);
  }
}

function shopOf(timer: ShopTimer): string {
  if (timer.shopId === null) throw new Error('An operations timer needs a shop');
  return timer.shopId;
}
