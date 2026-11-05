import type { Logger } from 'pino';
import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { CustomersService } from '../customers/customers.service';
import { straightLineMeters } from '../delivery/distance.domain';
import type { Coordinates } from '../delivery/location.domain';
import type { ZoneFactorService } from '../delivery/zone-factors.service';
import type { EventBus } from '../../shared/events';
import type { OrderService } from '../orders/orders.service';
import type { Button } from '../owner/owner.domain';
import type { Messenger } from '../owner/owner-notifier.service';
import type { DeliveryJobsRepo, StopRow } from './delivery-jobs.repo';
import {
  deliveredQuestion,
  deliverPrompt,
  offPinAlert,
  onTheWay,
} from './dispatch-messages.domain';
import { lateAt, minutesBetween, needsReview, point, RECEIPT_WINDOW_MS } from './dispatch.domain';
import type { DriverRow, DriversRepo } from './drivers.repo';
import { jobCallbackData, receiptCallbackData, type ReceiptAnswer } from './drivers.schemas';
import type { DeliveryOwnerAlerts } from './owner-alerts.service';

export const RECEIPT_TIMER = 'drivers.receipt_timeout';
/** Fires once per trip, when a picked-up trip should have ended. The target is the job. */
export const DELIVERY_LATE_TIMER = 'drivers.delivery_late';

interface TimerScheduler {
  schedule(
    tx: Transaction,
    kind: string,
    targetId: string,
    shopId: string | null,
    dueAt: Date,
  ): Promise<unknown>;
}

export type DeliveryResult =
  { status: 'delivered'; orderId: string; jobDone: boolean } | { status: 'not_found' };

export type ReceiptResult = 'recorded' | 'already_answered' | 'not_found';

/** A trip after a driver accepts it: pickup, each delivery with its location check, and receipt. */
export class TripService {
  constructor(
    private readonly db: Database,
    private readonly jobs: DeliveryJobsRepo,
    private readonly drivers: DriversRepo,
    private readonly orders: Pick<OrderService, 'get' | 'getForCustomer' | 'transition'>,
    private readonly customers: Pick<CustomersService, 'get'>,
    private readonly messenger: Pick<Messenger, 'send'>,
    private readonly alerts: Pick<DeliveryOwnerAlerts, 'send'>,
    private readonly events: Pick<EventBus, 'publish'>,
    private readonly timers: TimerScheduler,
    private readonly legs: Pick<ZoneFactorService, 'recordLeg'>,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  /** Puts every order of the job on its way, and tells each customer who brings it. */
  async pickedUp(telegramUserId: number, jobId: string): Promise<boolean> {
    const found = await this.forDriver(telegramUserId, async (tx, driver) => {
      const pickedUpAt = this.now();
      const job = await this.jobs.pickUp(tx, jobId, driver.id, pickedUpAt);
      if (!job) return undefined;
      const lateCheck = lateAt(pickedUpAt, job.estimatedMinutes);
      await this.timers.schedule(tx, DELIVERY_LATE_TIMER, job.id, job.shopId, lateCheck);
      return { driver, stops: await this.jobs.stops(tx, job.id) };
    });
    if (!found) return false;
    const { shopId, result } = found;
    const { driver, stops } = result;

    for (const stop of stops) {
      await this.orders.transition(shopId, stop.orderId, 'picked_up', 'driver', 'Picked up');
    }
    for (const stop of stops) {
      const order = await this.orders.get(shopId, stop.orderId);
      const customer = await this.customers.get(shopId, order.customerId);
      const name = driver.name ?? driver.username;
      await this.tell(customer.telegramUserId, onTheWay(order.id, { name, phone: driver.phone }));
      await this.tell(
        telegramUserId,
        deliverPrompt({ position: stop.position, customerName: customer.name }),
        [
          { text: '✅ Delivered / ደርሷል', data: jobCallbackData('delivered', stop.id) },
          { text: '⚠️ Problem / ችግር', data: jobCallbackData('problem', stop.jobId) },
        ],
      );
    }
    return true;
  }

  /** In the chat, **Delivered** first asks for the location. Returns false for another's stop. */
  async requestLocation(telegramUserId: number, stopId: string): Promise<boolean> {
    const found = await this.forDriver(
      telegramUserId,
      async (tx, driver) =>
        (await this.jobs.requestLocation(tx, stopId, driver.id, this.now())) || undefined,
    );
    return found !== undefined;
  }

  /** A location from the driver confirms the stop they last tapped **Delivered** for. */
  async deliverPending(telegramUserId: number, location: Coordinates): Promise<DeliveryResult> {
    const pending = await this.forDriver(telegramUserId, (tx, driver) =>
      this.jobs.awaitingLocation(tx, driver.id),
    );
    if (!pending) return { status: 'not_found' };
    return this.confirmDelivery(telegramUserId, pending.result.id, location);
  }

  /**
   * Delivers one stop at the driver's location. More than 300 m from the pin, it still counts as
   * delivered, and the owners review it. The customer gets two hours to report a problem.
   */
  async confirmDelivery(
    telegramUserId: number,
    stopId: string,
    location: Coordinates,
  ): Promise<DeliveryResult> {
    const found = await this.forDriver(telegramUserId, (tx, driver) =>
      this.jobs.stopOnTheWay(tx, stopId, driver.id),
    );
    if (!found) return { status: 'not_found' };
    const { shopId, result: stop } = found;
    const order = await this.orders.get(shopId, stop.orderId);
    const pin = point(order.deliveryLatitude, order.deliveryLongitude);
    if (!pin) throw new Error('A delivery order has no pin');
    const metersFromPin = Math.round(straightLineMeters(location, pin));
    const review = needsReview(metersFromPin);

    const delivered = await withShop(this.db, shopId, async (tx) => {
      const now = this.now();
      const done = await this.jobs.deliver(tx, stop.id, {
        deliveredAt: now,
        metersFromPin,
        needsReview: review,
      });
      if (!done) return undefined;
      const receiptDue = new Date(now.getTime() + RECEIPT_WINDOW_MS);
      await this.timers.schedule(tx, RECEIPT_TIMER, stop.orderId, shopId, receiptDue);
      const legStart = await this.jobs.legStart(tx, done);
      if ((await this.jobs.undeliveredStops(tx, stop.jobId)) > 0) {
        return { jobDone: false, legStart };
      }
      const job = await this.jobs.findJob(tx, stop.jobId);
      const actualMinutes = minutesBetween(job?.pickedUpAt ?? now, now);
      await this.jobs.finish(tx, stop.jobId, { deliveredAt: now, actualMinutes });
      return { jobDone: true, legStart };
    });
    if (!delivered) return { status: 'not_found' };
    await this.recordLeg(stop, pin, delivered.legStart);

    const reason = review ? `Delivered ${String(metersFromPin)} m from the pin` : 'Delivered';
    await this.orders.transition(shopId, order.id, 'delivered', 'driver', reason);
    const customer = await this.customers.get(shopId, order.customerId);
    await this.tell(customer.telegramUserId, deliveredQuestion(order.id), [
      { text: '✅ Received / ደርሶኛል', data: receiptCallbackData('received', order.id) },
      { text: '⚠️ Problem / ችግር አለ', data: receiptCallbackData('problem', order.id) },
    ]);
    if (review) await this.alerts.send(shopId, offPinAlert(order.id, metersFromPin));
    return { status: 'delivered', orderId: order.id, jobDone: delivered.jobDone };
  }

  /** Only the first answer counts. A problem goes on to the operations agent as an event. */
  async confirmReceipt(
    telegramUserId: number,
    orderId: string,
    answer: ReceiptAnswer,
  ): Promise<ReceiptResult> {
    let order;
    try {
      order = await this.orders.getForCustomer(telegramUserId, orderId);
    } catch (err) {
      if (err instanceof AppError && err.code === 'NOT_FOUND') return 'not_found';
      throw err;
    }
    const { shopId } = order;
    const recorded = await withShop(this.db, shopId, (tx) =>
      this.jobs.setReceipt(tx, orderId, answer, this.now()),
    );
    if (!recorded) return 'already_answered';
    if (answer === 'problem') {
      await this.events.publish('delivery.problem_reported', { shopId, orderId });
    }
    return 'recorded';
  }

  /** The receipt timer handler: without an answer in two hours, the customer received the order. */
  async receiptTimeout(timer: { targetId: string; shopId: string | null }): Promise<void> {
    const { shopId, targetId } = timer;
    if (shopId === null) throw new Error('A receipt timer needs a shop');
    await withShop(this.db, shopId, (tx) =>
      this.jobs.setReceipt(tx, targetId, 'assumed', this.now()),
    );
  }

  /** Teaches the time factors how long the leg to this stop took. Older stops have no times. */
  private async recordLeg(
    stop: StopRow,
    destination: Coordinates,
    startedAt: Date | undefined,
  ): Promise<void> {
    const { routingSeconds, expectedSeconds } = stop;
    if (!startedAt || routingSeconds === null || expectedSeconds === null) return;
    const actualSeconds = Math.round((this.now().getTime() - startedAt.getTime()) / 1000);
    await this.legs.recordLeg({
      destination,
      startedAt,
      routingSeconds,
      expectedSeconds,
      actualSeconds,
    });
  }

  /**
   * Takes an undelivered order off its trip and ends the trip if nothing is left to deliver.
   * Returns the driver's chat, or `undefined` when the order was not on the way.
   */
  async dropStop(shopId: string, orderId: string): Promise<{ driverChatId: number } | undefined> {
    return withShop(this.db, shopId, async (tx) => {
      const stop = await this.jobs.removeStop(tx, orderId);
      const job = stop && (await this.jobs.findJob(tx, stop.jobId));
      if (!job?.driverId) return undefined;
      if ((await this.jobs.undeliveredStops(tx, job.id)) === 0) {
        const now = this.now();
        const actualMinutes = minutesBetween(job.pickedUpAt ?? now, now);
        await this.jobs.finish(tx, job.id, { deliveredAt: now, actualMinutes });
      }
      const driver = await this.drivers.find(tx, job.driverId);
      const chatId = driver?.telegramUserId ?? null;
      return chatId === null ? undefined : { driverChatId: chatId };
    });
  }

  /** Runs `work` in each shop the user drives for, until one returns a result. */
  private async forDriver<T>(
    telegramUserId: number,
    work: (tx: Transaction, driver: DriverRow) => Promise<T | undefined>,
  ): Promise<{ shopId: string; result: T } | undefined> {
    for (const shopId of await this.drivers.shopIdsOf(this.db, telegramUserId)) {
      const result = await withShop(this.db, shopId, async (tx) => {
        const driver = await this.drivers.byTelegramUser(tx, telegramUserId);
        return driver && work(tx, driver);
      });
      if (result !== undefined) return { shopId, result };
    }
    return undefined;
  }

  /** A customer or driver who blocked the bot does not stop the trip. */
  private async tell(chatId: number, text: string, buttons: Button[] = []): Promise<void> {
    try {
      await this.messenger.send(chatId, text, buttons);
    } catch (err) {
      // Only the message: a Telegram error object also holds the request with its text.
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.error({ reason }, 'trip message failed');
    }
  }
}
