import type { Money, OrderStatus } from '@buchi/shared';
import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withShop } from '../../db/with-shop';
import type { CustomersService } from '../customers/customers.service';
import type { DeliveryService } from '../delivery/delivery.service';
import type { OrderService, OrderWithItems } from '../orders/orders.service';
import type { Messenger } from '../owner/owner-notifier.service';
import type { ShopsService } from '../shops/shops.service';
import type { DeliveryJobsRepo, JobRow, StopRow } from './delivery-jobs.repo';
import { jobDetails, readyForPickup, takenNotice } from './dispatch-messages.domain';
import { point } from './dispatch.domain';
import type { DriversRepo } from './drivers.repo';
import { jobCallbackData } from './drivers.schemas';
import type { JobOffers } from './job-offers.service';

/** One trip to offer: its stops in visiting order and what the formula pays for it. */
export interface JobPlan {
  orderIds: string[];
  payout: Money;
  separateTripsPayout: Money;
  routeMeters: number;
  estimatedMinutes: number;
}

export type AcceptResult = 'accepted' | 'closed' | 'not_found';

/**
 * Turns paid orders into delivery jobs, offers them to drivers, and gives each job to the first
 * driver who accepts.
 */
export class DispatchService {
  constructor(
    private readonly db: Database,
    private readonly jobs: DeliveryJobsRepo,
    private readonly drivers: DriversRepo,
    private readonly offers: JobOffers,
    private readonly orders: Pick<OrderService, 'get' | 'summary' | 'transition'>,
    private readonly customers: Pick<CustomersService, 'get'>,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly delivery: Pick<DeliveryService, 'tripTo'>,
    private readonly messenger: Pick<Messenger, 'send'>,
    private readonly now: () => Date,
  ) {}

  /** Dispatches an order once it is paid, by its delivery type. */
  async orderTransitioned(event: {
    shopId: string;
    orderId: string;
    to: OrderStatus;
  }): Promise<void> {
    if (event.to !== 'paid') return;
    const order = await this.orders.get(event.shopId, event.orderId);
    switch (order.deliveryType) {
      case 'pickup':
        return this.readyForPickup(order);
      case 'express':
      case 'free':
        return this.dispatchNow(order);
      // Saver orders wait for the shop's next Saver run. Far-area orders come with Task 5.6.
      case 'saver':
      case 'far':
        return;
    }
  }

  /**
   * Creates the job and its first offer in one transaction, then offers it to the shop's available
   * drivers. Returns false when an order is already on a job, so a repeated run changes nothing.
   */
  async createJob(shopId: string, plan: JobPlan): Promise<boolean> {
    let offer;
    try {
      offer = await withShop(this.db, shopId, async (tx) => {
        const job = await this.jobs.insertJob(tx, {
          shopId,
          orderIds: plan.orderIds,
          payout: plan.payout.toString(),
          separateTripsPayout: plan.separateTripsPayout.toString(),
          routeMeters: plan.routeMeters,
          estimatedMinutes: plan.estimatedMinutes,
        });
        return this.offers.open(tx, { shopId, jobId: job.id, price: job.payout, raiseStep: 0 });
      });
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
    for (const orderId of plan.orderIds) {
      await this.orders.transition(shopId, orderId, 'dispatched', 'system', 'Offered to drivers');
    }
    await this.offers.broadcast(shopId, offer);
    return true;
  }

  /**
   * The first driver to accept gets the job and, only now, the customers' names, phones, and pins.
   * Every other driver's offer message changes to "Taken".
   */
  async accept(telegramUserId: number, offerId: string): Promise<AcceptResult> {
    for (const shopId of await this.drivers.shopIdsOf(this.db, telegramUserId)) {
      const outcome = await withShop(this.db, shopId, async (tx) => {
        const offer = await this.jobs.findOffer(tx, offerId);
        const driver = await this.drivers.byTelegramUser(tx, telegramUserId);
        if (!offer || !driver) return undefined;
        const taken = await this.jobs.takeOffer(tx, offerId, driver.id);
        if (!taken) return 'closed' as const;
        const job = await this.jobs.assign(tx, offer.jobId, {
          driverId: driver.id,
          payout: taken.price,
          acceptedAt: this.now(),
        });
        if (!job) throw new Error('An open offer belongs to a job that is no longer offered');
        return { job, stops: await this.jobs.stops(tx, job.id) };
      });
      if (outcome === undefined) continue;
      if (outcome === 'closed') return 'closed';

      for (const stop of outcome.stops) {
        await this.orders.transition(
          shopId,
          stop.orderId,
          'driver_assigned',
          'driver',
          'A driver accepted the job',
        );
      }
      await this.offers.close(shopId, offerId, takenNotice, telegramUserId);
      await this.sendDetails(shopId, telegramUserId, outcome.job, outcome.stops);
      return 'accepted';
    }
    return 'not_found';
  }

  private async readyForPickup(order: OrderWithItems): Promise<void> {
    const { shopId, id } = order;
    await this.orders.transition(shopId, id, 'ready_for_pickup', 'system', 'Paid for pickup');
    const [shop, customer] = await Promise.all([
      this.shops.get(shopId),
      this.customers.get(shopId, order.customerId),
    ]);
    const text = readyForPickup(id, { name: shop.name, pin: point(shop.latitude, shop.longitude) });
    await this.messenger.send(customer.telegramUserId, text, []);
  }

  private async dispatchNow(order: OrderWithItems): Promise<void> {
    const destination = point(order.deliveryLatitude, order.deliveryLongitude);
    if (!destination) throw new Error('A delivery order has no pin');
    const trip = await this.delivery.tripTo(order.shopId, destination);
    if (!trip) throw new Error('The shop no longer has delivery settings');
    await this.createJob(order.shopId, {
      orderIds: [order.id],
      payout: trip.payout,
      separateTripsPayout: trip.payout,
      routeMeters: trip.meters,
      estimatedMinutes: trip.expectedMinutes,
    });
  }

  private async sendDetails(
    shopId: string,
    chatId: number,
    job: JobRow,
    stops: StopRow[],
  ): Promise<void> {
    const shop = await this.shops.get(shopId);
    const details = await Promise.all(
      stops.map(async (stop) => {
        const [order, summary] = await Promise.all([
          this.orders.get(shopId, stop.orderId),
          this.orders.summary(shopId, stop.orderId),
        ]);
        const customer = await this.customers.get(shopId, order.customerId);
        const pin = point(order.deliveryLatitude, order.deliveryLongitude);
        if (!pin) throw new Error('A delivery order has no pin');
        return {
          position: stop.position,
          orderId: stop.orderId,
          customerName: summary.customerName,
          phone: customer.phone,
          pin,
          lines: summary.lines,
        };
      }),
    );
    const text = jobDetails({
      shopName: shop.name,
      shopPin: point(shop.latitude, shop.longitude),
      payout: job.payout,
      stops: details,
    });
    await this.messenger.send(chatId, text, [
      { text: '📦 Picked up / ተቀብያለሁ', data: jobCallbackData('picked', job.id) },
    ]);
  }
}
