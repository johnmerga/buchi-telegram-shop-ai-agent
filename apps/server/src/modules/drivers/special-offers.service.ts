import type { Money } from '@buchi/shared';
import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { EventBus } from '../../shared/events';
import type { DeliveryJobsRepo, JobRow, NewStop, OfferRow, StopRow } from './delivery-jobs.repo';
import { raisedNotice, takenNotice, withdrawnNotice } from './dispatch-messages.domain';
import type { DriversRepo } from './drivers.repo';
import type { JobOffers } from './job-offers.service';
import type { SpecialJobsRepo } from './special-jobs.repo';

export const SPECIAL_OFFER_RAISE_TIMER = 'drivers.special_offer_raise';

/** The design doc's rule: a special offer without an accept rises after five minutes. */
const RAISE_AFTER_MS = 5 * 60_000;

interface TimerScheduler {
  schedule(
    tx: Transaction,
    kind: string,
    targetId: string,
    shopId: string | null,
    dueAt: Date,
  ): Promise<unknown>;
}

/** A far-area trip to offer: one stop, priced by the far-quote flow, not by the formula. */
export interface SpecialJob {
  stop: NewStop;
  routeMeters: number;
  estimatedMinutes: number;
}

export type HoldResult = 'held' | 'closed' | 'not_found';

/**
 * Far-area jobs under **Special offers**. The first driver to accept holds the job while the
 * customer confirms and pays, and gets it only once the order is paid. Prices come from the caller,
 * which owns the cap; this service only opens, replaces, holds, and withdraws offers.
 */
export class SpecialOffers {
  constructor(
    private readonly db: Database,
    private readonly jobs: DeliveryJobsRepo,
    private readonly special: SpecialJobsRepo,
    private readonly drivers: DriversRepo,
    private readonly offers: Pick<JobOffers, 'broadcast' | 'close' | 'closeMessages'>,
    private readonly timers: TimerScheduler,
    private readonly events: Pick<EventBus, 'publish'>,
    private readonly now: () => Date,
  ) {}

  /** Creates the job and its first offer, which rises after five minutes when `rises` is set. */
  async open(shopId: string, job: SpecialJob, price: Money, rises: boolean): Promise<void> {
    const offer = await withShop(this.db, shopId, async (tx) => {
      const row = await this.jobs.insertJob(tx, {
        shopId,
        special: true,
        payout: price.toString(),
        separateTripsPayout: price.toString(),
        routeMeters: job.routeMeters,
        estimatedMinutes: job.estimatedMinutes,
        stops: [job.stop],
      });
      return this.insertOffer(tx, shopId, row.id, price, 0, rises);
    });
    await this.offers.broadcast(shopId, offer);
  }

  /** The offer with the order it is for, while it is still open. */
  async openOffer(
    shopId: string,
    offerId: string,
  ): Promise<{ offer: OfferRow; orderId: string } | undefined> {
    return withShop(this.db, shopId, async (tx) => {
      const offer = await this.jobs.findOffer(tx, offerId);
      if (offer?.status !== 'open') return undefined;
      const [stop] = await this.jobs.stops(tx, offer.jobId);
      return stop && { offer, orderId: stop.orderId };
    });
  }

  /** Replaces an open offer with one at a higher price. Returns false once it is no longer open. */
  async raise(
    shopId: string,
    offerId: string,
    price: Money,
    risesAgain: boolean,
  ): Promise<boolean> {
    const raised = await withShop(this.db, shopId, async (tx) => {
      const offer = await this.jobs.expireOffer(tx, offerId);
      if (!offer) return undefined;
      return this.insertOffer(tx, shopId, offer.jobId, price, offer.raiseStep + 1, risesAgain);
    });
    if (!raised) return false;
    await this.offers.close(shopId, offerId, raisedNotice);
    await this.offers.broadcast(shopId, raised);
    return true;
  }

  /** First accept wins. The other drivers' messages change to "Taken". */
  async hold(telegramUserId: number, offerId: string): Promise<HoldResult> {
    for (const shopId of await this.drivers.shopIdsOf(this.db, telegramUserId)) {
      const held = await withShop(this.db, shopId, async (tx) => {
        const driver = await this.drivers.byTelegramUser(tx, telegramUserId);
        if (!driver || !(await this.jobs.findOffer(tx, offerId))) return undefined;
        const offer = await this.special.holdOffer(tx, offerId, driver.id);
        if (!offer) return 'closed' as const;
        const [stop] = await this.jobs.stops(tx, offer.jobId);
        if (!stop) throw new Error('A special job has no stop');
        return { offer, orderId: stop.orderId };
      });
      if (held === undefined) continue;
      if (held === 'closed') return 'closed';
      await this.offers.close(shopId, offerId, takenNotice, telegramUserId);
      await this.events.publish('delivery.offer_held', {
        shopId,
        orderId: held.orderId,
        price: held.offer.price,
        raises: held.offer.raiseStep,
      });
      return 'held';
    }
    return 'not_found';
  }

  /**
   * Gives the job of a paid far-area order to the driver who held it, with the held price as the
   * payout. Returns nothing when no driver holds it.
   */
  async assignHolder(
    shopId: string,
    orderId: string,
  ): Promise<{ job: JobRow; stops: StopRow[]; chatId: number } | undefined> {
    return withShop(this.db, shopId, async (tx) => {
      const offer = await this.special.takeHeldOffer(tx, orderId);
      if (!offer?.takenByDriverId) return undefined;
      const driver = await this.drivers.find(tx, offer.takenByDriverId);
      const job = await this.jobs.assign(tx, offer.jobId, {
        driverId: offer.takenByDriverId,
        payout: offer.price,
        acceptedAt: this.now(),
      });
      const chatId = driver?.telegramUserId ?? null;
      if (!job || chatId === null) throw new Error('A held far-area job cannot go to its driver');
      return { job, chatId, stops: await this.jobs.stops(tx, job.id) };
    });
  }

  /**
   * Withdraws the order's special job, held or not, and tells every driver who got an offer for
   * it. Does nothing when the order has no special job waiting.
   */
  async withdraw(shopId: string, orderId: string): Promise<void> {
    const messages = await withShop(this.db, shopId, async (tx) => {
      const job = await this.special.untakenJobOf(tx, orderId);
      if (!job) return [];
      const sent = await this.special.offerMessages(tx, job.id);
      await this.special.deleteJob(tx, job.id);
      return sent;
    });
    await this.offers.closeMessages(shopId, messages, withdrawnNotice);
  }

  private async insertOffer(
    tx: Transaction,
    shopId: string,
    jobId: string,
    price: Money,
    raiseStep: number,
    rises: boolean,
  ): Promise<OfferRow> {
    const offer = await this.jobs.insertOffer(tx, {
      shopId,
      jobId,
      price: price.toString(),
      raiseStep,
    });
    if (rises) {
      const dueAt = new Date(this.now().getTime() + RAISE_AFTER_MS);
      await this.timers.schedule(tx, SPECIAL_OFFER_RAISE_TIMER, offer.id, shopId, dueAt);
    }
    return offer;
  }
}
