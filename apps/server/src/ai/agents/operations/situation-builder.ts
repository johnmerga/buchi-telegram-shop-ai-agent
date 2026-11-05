import type { CatalogService } from '../../../modules/catalog/catalog.service';
import type { AreaNoteService } from '../../../modules/delivery/area-notes.service';
import type { OpenOffer, Trip } from '../../../modules/drivers/trip-details.service';
import type { ProblemKind } from '../../../modules/operations/operations.schemas';
import type { OrderService } from '../../../modules/orders/orders.service';
import type { ConversationService } from '../../../modules/owner/conversations.service';
import {
  firstName,
  type OrderFacts,
  type Situation,
  type SizeFacts,
  type TripFacts,
} from './situation.domain';

/** Enough of the chat to see what the customer is answering. */
const RECENT_CHAT_TURNS = 6;
const SALES_WINDOW_MS = 30 * 24 * 60 * 60_000;

/**
 * Collects what the operations agent needs for one situation from the records: the order, its
 * timeline, the messages, and the limits. Customers and drivers appear by first name only, and
 * no phone number or pin reaches the prompt.
 */
export class SituationBuilder {
  constructor(
    private readonly orders: Pick<OrderService, 'get' | 'summary' | 'timeline' | 'unitsSold'>,
    private readonly catalog: Pick<CatalogService, 'variantForSale' | 'activeProducts'>,
    private readonly conversations: Pick<ConversationService, 'recentTurns'>,
    private readonly areaNotes: Pick<AreaNoteService, 'near'>,
    private readonly now: () => Date,
  ) {}

  async paymentDeadline(
    shopId: string,
    orderId: string,
    customer: { telegramUserId: number; name: string },
    message: string,
  ): Promise<Situation> {
    const [order, turns] = await Promise.all([
      this.order(shopId, orderId),
      this.conversations.recentTurns(shopId, customer),
    ]);
    const recentChat = turns
      .slice(-RECENT_CHAT_TURNS)
      .map((turn) => `- ${turn.role === 'customer' ? 'Customer' : 'Buchi'}: ${turn.text}`);
    return { shopId, kind: 'payment_deadline', order, customerMessage: message, recentChat };
  }

  async driverReport(shopId: string, trip: Trip, message: string): Promise<Situation> {
    const facts = await this.trip(shopId, trip);
    const areaNotes = await this.notesAhead(shopId, facts);
    return { shopId, kind: 'driver_report', trip: facts, driverMessage: message, areaNotes };
  }

  async deliveryLate(shopId: string, trip: Trip): Promise<Situation> {
    const facts = await this.trip(shopId, trip);
    return {
      shopId,
      kind: 'delivery_late',
      trip: facts,
      areaNotes: await this.notesAhead(shopId, facts),
    };
  }

  async noDriverAccepted(shopId: string, offer: OpenOffer): Promise<Situation> {
    return {
      shopId,
      kind: 'no_driver_accepted',
      offer: {
        offerId: offer.offerId,
        price: offer.price,
        raiseStep: offer.raiseStep,
        openedAt: offer.openedAt,
      },
      availableDrivers: offer.availableDrivers,
      trip: await this.trip(shopId, offer.trip),
    };
  }

  async deliveryProblem(
    shopId: string,
    orderId: string,
    problem: ProblemKind,
    wantedSize: string | undefined,
  ): Promise<Situation> {
    const order = await this.order(shopId, orderId);
    const forSale = await Promise.all(
      order.items.map((item) => this.catalog.variantForSale(shopId, item.variantId)),
    );
    const productIds = [...new Set(forSale.flatMap((found) => (found ? [found.product.id] : [])))];
    const products = await this.catalog.activeProducts(shopId, productIds);
    const sizes = products.flatMap((product) =>
      product.variants.map((variant) => ({
        title: product.title,
        variantId: variant.id,
        size: variant.size,
        available: Math.max(0, variant.stock - variant.reserved),
      })),
    );
    return { shopId, kind: 'delivery_problem', order, problem, wantedSize, sizes };
  }

  /** Returns `undefined` when the size is no longer for sale. */
  async waitlist(
    shopId: string,
    variantId: string,
    waiting: number,
  ): Promise<Situation | undefined> {
    const forSale = await this.catalog.variantForSale(shopId, variantId);
    if (!forSale) return undefined;
    const { product, variant } = forSale;
    const since = new Date(this.now().getTime() - SALES_WINDOW_MS);
    const size: SizeFacts = {
      variantId,
      size: variant.size,
      available: Math.max(0, variant.stock - variant.reserved),
    };
    return {
      shopId,
      kind: 'waitlist',
      product: { title: product.title, stock: variant.stock, ...size },
      waiting,
      soldLast30Days: await this.orders.unitsSold(shopId, variantId, since),
    };
  }

  private async order(shopId: string, orderId: string): Promise<OrderFacts> {
    const [order, summary, events] = await Promise.all([
      this.orders.get(shopId, orderId),
      this.orders.summary(shopId, orderId),
      this.orders.timeline(shopId, orderId),
    ]);
    return {
      orderId,
      status: order.status,
      deliveryType: order.deliveryType,
      total: order.total,
      paymentDeadline: order.paymentDeadline,
      deadlineExtensions: order.deadlineExtensions,
      customerFirstName: firstName(summary.customerName),
      items: summary.lines,
      timeline: events.map((event) => ({
        at: event.createdAt,
        to: event.toStatus,
        reason: event.reason,
      })),
    };
  }

  private async trip(shopId: string, trip: Trip): Promise<TripFacts> {
    const stops = await Promise.all(
      trip.stops.map(async (stop) => ({
        position: stop.position,
        delivered: stop.delivered,
        order: await this.order(shopId, stop.orderId),
      })),
    );
    return {
      jobId: trip.jobId,
      status: trip.status,
      payout: trip.payout,
      estimatedMinutes: trip.estimatedMinutes,
      pickedUpAt: trip.pickedUpAt,
      driverFirstName: trip.driver && firstName(trip.driver.name),
      stops,
    };
  }

  /** Notes about the area of the next stop, where the driver is heading. */
  private async notesAhead(shopId: string, trip: TripFacts): Promise<string[]> {
    const next = trip.stops.find((stop) => !stop.delivered);
    if (!next) return [];
    const order = await this.orders.get(shopId, next.order.orderId);
    if (order.deliveryLatitude === null || order.deliveryLongitude === null) return [];
    const near = { latitude: order.deliveryLatitude, longitude: order.deliveryLongitude };
    const now = this.now().getTime();
    return (await this.areaNotes.near(shopId, near)).map((note) => {
      const hours = Math.round((now - note.createdAt.getTime()) / (60 * 60_000));
      return `${note.note} (${String(hours)} h ago)`;
    });
  }
}
