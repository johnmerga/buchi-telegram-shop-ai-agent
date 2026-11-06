import type { MoneyString } from '@buchi/shared';
import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { DeliveryJobsRepo, JobRow } from './delivery-jobs.repo';
import { driverDisplayName } from './drivers.domain';
import type { DriversRepo } from './drivers.repo';

interface TripDriver {
  telegramUserId: number;
  name: string;
  phone: string | null;
}

/** A delivery job as the operations agent's situations describe it. */
export interface Trip {
  jobId: string;
  status: JobRow['status'];
  payout: MoneyString;
  routeMeters: number;
  estimatedMinutes: number;
  pickedUpAt: Date | null;
  driver: TripDriver | undefined;
  stops: { orderId: string; position: number; delivered: boolean }[];
}

export interface OpenOffer {
  offerId: string;
  price: MoneyString;
  raiseStep: number;
  openedAt: Date;
  trip: Trip;
  availableDrivers: number;
}

/** Read-only views of trips and offers, for the situations that wake the operations agent. */
export class TripDetails {
  constructor(
    private readonly db: Database,
    private readonly jobs: DeliveryJobsRepo,
    private readonly drivers: DriversRepo,
  ) {}

  trip(shopId: string, jobId: string): Promise<Trip | undefined> {
    return withShop(this.db, shopId, async (tx) => {
      const job = await this.jobs.findJob(tx, jobId);
      return job && this.view(tx, job);
    });
  }

  tripOfOrder(shopId: string, orderId: string): Promise<Trip | undefined> {
    return withShop(this.db, shopId, async (tx) => {
      const stop = await this.jobs.stopOf(tx, orderId);
      const job = stop && (await this.jobs.findJob(tx, stop.jobId));
      return job && this.view(tx, job);
    });
  }

  /** The trip a driver is on now, in whichever shop they drive for. */
  async activeTripOf(telegramUserId: number): Promise<{ shopId: string; trip: Trip } | undefined> {
    for (const shopId of await this.drivers.shopIdsOf(this.db, telegramUserId)) {
      const trip = await withShop(this.db, shopId, async (tx) => {
        const driver = await this.drivers.byTelegramUser(tx, telegramUserId);
        const job = driver && (await this.jobs.activeJobOf(tx, driver.id));
        return job && this.view(tx, job);
      });
      if (trip) return { shopId, trip };
    }
    return undefined;
  }

  /** An offer that no driver has taken yet, or `undefined` once it closed. */
  openOffer(shopId: string, offerId: string): Promise<OpenOffer | undefined> {
    return withShop(this.db, shopId, async (tx) => {
      const offer = await this.jobs.findOffer(tx, offerId);
      const job = offer?.status === 'open' ? await this.jobs.findJob(tx, offer.jobId) : undefined;
      if (!offer || !job) return undefined;
      return {
        offerId: offer.id,
        price: offer.price,
        raiseStep: offer.raiseStep,
        openedAt: offer.createdAt,
        trip: await this.view(tx, job),
        availableDrivers: (await this.drivers.available(tx)).length,
      };
    });
  }

  private async view(tx: Transaction, job: JobRow): Promise<Trip> {
    const [stops, driver] = await Promise.all([
      this.jobs.stops(tx, job.id),
      job.driverId === null ? undefined : this.drivers.find(tx, job.driverId),
    ]);
    return {
      jobId: job.id,
      status: job.status,
      payout: job.payout,
      routeMeters: job.routeMeters,
      estimatedMinutes: job.estimatedMinutes,
      pickedUpAt: job.pickedUpAt,
      driver:
        driver === undefined || driver.telegramUserId === null
          ? undefined
          : {
              telegramUserId: driver.telegramUserId,
              name: driverDisplayName(driver),
              phone: driver.phone,
            },
      stops: stops.map((stop) => ({
        orderId: stop.orderId,
        position: stop.position,
        delivered: stop.deliveredAt !== null,
      })),
    };
  }
}
