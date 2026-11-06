import type { Logger } from 'pino';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { CustomersService } from '../customers/customers.service';
import type { Coordinates } from '../delivery/location.domain';
import type { OrderService } from '../orders/orders.service';
import type { MessageRef, Messenger } from '../owner/owner-notifier.service';
import type { DeliveryJobsRepo, StopRow } from './delivery-jobs.repo';
import { liveMapIntro } from './dispatch-messages.domain';
import type { DriversRepo } from './drivers.repo';
import { forDriver } from './for-driver';
import { customerLivePeriod, tooSoon, type LiveShare } from './live-location.domain';

/** Live Location messages in customers' chats. */
export interface LiveMap {
  /** Sends a live map at the point, and returns its message ID. */
  send(chatId: number, point: Coordinates, livePeriod: number): Promise<number>;
  move(message: MessageRef, point: Coordinates): Promise<void>;
  stop(message: MessageRef): Promise<void>;
}

/** Telegram's answer to an edit that moves a map to where it already is. */
const NOT_MODIFIED = 'message is not modified';

/**
 * Follows a driver's Live Location during a trip: the latest point stays on the trip, and each
 * customer still waiting gets a live map in their chat that moves with the driver.
 */
export class LiveTracking {
  constructor(
    private readonly db: Database,
    private readonly jobs: DeliveryJobsRepo,
    private readonly drivers: Pick<DriversRepo, 'shopIdsOf' | 'byTelegramUser'>,
    private readonly orders: Pick<OrderService, 'get'>,
    private readonly customers: Pick<CustomersService, 'get'>,
    private readonly messenger: Pick<Messenger, 'send'>,
    private readonly map: LiveMap,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  /**
   * A Live Location update from a driver. Returns false when the driver has no trip on the road,
   * so the update means nothing here.
   */
  async driverMoved(telegramUserId: number, share: LiveShare): Promise<boolean> {
    const now = this.now();
    const found = await forDriver(this.db, this.drivers, telegramUserId, async (tx, driver) => {
      const job = await this.jobs.jobOnTheWay(tx, driver.id);
      if (!job) return undefined;
      if ('stopped' in share) {
        await this.jobs.clearLivePoint(tx, job.id);
      } else {
        if (tooSoon(job.liveAt, now)) return [];
        await this.jobs.setLivePoint(tx, job.id, {
          point: share.point,
          at: now,
          until: share.until,
        });
      }
      const stops = await this.jobs.stops(tx, job.id);
      return stops.filter((stop) => stop.deliveredAt === null);
    });
    if (!found) return false;
    const { shopId, result: waiting } = found;
    for (const stop of waiting) {
      if ('stopped' in share) await this.stopFor(shopId, stop);
      else await this.follow(shopId, stop, share.point, customerLivePeriod(share.until, now));
    }
    return true;
  }

  /** Ends the stop's live map, once its order is delivered or taken off the trip. */
  async stopMap(stop: StopRow): Promise<void> {
    const message = liveMessageOf(stop);
    if (message) await this.attempt(() => this.map.stop(message));
  }

  private async stopFor(shopId: string, stop: StopRow): Promise<void> {
    await this.stopMap(stop);
    await withShop(this.db, shopId, (tx) => this.jobs.setLiveMessage(tx, stop.id, null));
  }

  /** Moves the customer's map, or starts one on the first point. */
  private async follow(
    shopId: string,
    stop: StopRow,
    point: Coordinates,
    livePeriod: number,
  ): Promise<void> {
    const message = liveMessageOf(stop);
    if (message) {
      await this.attempt(() => this.map.move(message, point));
      return;
    }
    const order = await this.orders.get(shopId, stop.orderId);
    const { telegramUserId: chatId } = await this.customers.get(shopId, order.customerId);
    await this.attempt(async () => {
      await this.messenger.send(chatId, liveMapIntro(order.id), []);
      const messageId = await this.map.send(chatId, point, livePeriod);
      await withShop(this.db, shopId, (tx) =>
        this.jobs.setLiveMessage(tx, stop.id, { chatId, messageId }),
      );
    });
  }

  /** A customer who blocked the bot, or a map that already ended, does not stop the trip. */
  private async attempt(call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch (err) {
      // Only the message: a Telegram error object also holds the request with its coordinates.
      const reason = err instanceof Error ? err.message : 'unknown error';
      if (!reason.includes(NOT_MODIFIED)) this.logger.warn({ reason }, 'live map update failed');
    }
  }
}

function liveMessageOf(stop: StopRow): MessageRef | null {
  const { liveChatId: chatId, liveMessageId: messageId } = stop;
  return chatId === null || messageId === null ? null : { chatId, messageId };
}
