import type { DriverBoard, OpenOffer, Trip, TripStop } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { CustomersService } from '../customers/customers.service';
import type { OrderService } from '../orders/orders.service';
import type { ShopsService } from '../shops/shops.service';
import type { DeliveryJobsRepo, StopRow } from './delivery-jobs.repo';
import { point } from './dispatch.domain';
import type { ActiveJobRow, DriverBoardRepo, OpenOfferRow } from './driver-board.repo';
import type { DriversRepo } from './drivers.repo';

/** What a driver sees in the Mini App, across every shop they drive for. */
export class DriverBoardService {
  constructor(
    private readonly db: Database,
    private readonly repo: DriverBoardRepo,
    private readonly jobs: Pick<DeliveryJobsRepo, 'stops'>,
    private readonly drivers: Pick<DriversRepo, 'shopIdsOf' | 'byTelegramUser'>,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly orders: Pick<OrderService, 'get'>,
    private readonly customers: Pick<CustomersService, 'get'>,
  ) {}

  async board(telegramUserId: number): Promise<DriverBoard> {
    const board: DriverBoard = { offers: [], trips: [], earnings: [] };
    for (const shopId of await this.drivers.shopIdsOf(this.db, telegramUserId)) {
      const found = await withShop(this.db, shopId, async (tx) => {
        const driver = await this.drivers.byTelegramUser(tx, telegramUserId);
        if (!driver) return undefined;
        return {
          offers: await this.repo.openOffers(tx),
          jobs: await Promise.all(
            (await this.repo.activeJobs(tx, driver.id)).map(async (job) => ({
              job,
              stops: await this.jobs.stops(tx, job.jobId),
            })),
          ),
          delivered: await this.repo.deliveredTotals(tx, driver.id),
        };
      });
      if (!found) continue;
      const shop = await this.shops.get(shopId);
      board.offers.push(...found.offers.map((offer) => openOffer(shop.name, offer)));
      for (const { job, stops } of found.jobs) {
        board.trips.push(await this.trip(shopId, shop, job, stops));
      }
      if (found.delivered.trips > 0) {
        board.earnings.push({
          shopName: shop.name,
          deliveredTrips: found.delivered.trips,
          payout: found.delivered.payout,
        });
      }
    }
    return board;
  }

  private async trip(
    shopId: string,
    shop: { name: string; latitude: number | null; longitude: number | null },
    job: ActiveJobRow,
    stops: StopRow[],
  ): Promise<Trip> {
    const details = await Promise.all(
      stops.map(async (stop): Promise<TripStop> => {
        const order = await this.orders.get(shopId, stop.orderId);
        const customer = await this.customers.get(shopId, order.customerId);
        const pin = point(order.deliveryLatitude, order.deliveryLongitude);
        if (!pin) throw new Error('A delivery order has no pin');
        return {
          stopId: stop.id,
          position: stop.position,
          customerName: customer.name,
          phone: customer.phone,
          pin,
          delivered: stop.deliveredAt !== null,
        };
      }),
    );
    return {
      jobId: job.jobId,
      shopName: shop.name,
      shopPin: point(shop.latitude, shop.longitude),
      status: job.status,
      payout: job.payout,
      stops: details,
    };
  }
}

function openOffer(shopName: string, offer: OpenOfferRow): OpenOffer {
  return {
    offerId: offer.offerId,
    shopName,
    price: offer.price,
    special: offer.raiseStep > 0,
    stops: offer.stops,
    routeMeters: offer.routeMeters,
    estimatedMinutes: offer.estimatedMinutes,
  };
}
