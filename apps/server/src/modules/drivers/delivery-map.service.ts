import type { DeliveryMap } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { ShopsService } from '../shops/shops.service';
import type { DeliveryMapRepo } from './delivery-map.repo';
import { point } from './dispatch.domain';

/** The owner's **Deliveries** map: every job that is offered or on its way, with its stops. */
export class DeliveryMapService {
  constructor(
    private readonly db: Database,
    private readonly repo: DeliveryMapRepo,
    private readonly shops: Pick<ShopsService, 'get'>,
  ) {}

  async map(shopId: string): Promise<DeliveryMap> {
    const shop = await this.shops.get(shopId);
    const { jobs, stops } = await withShop(this.db, shopId, async (tx) => {
      const open = await this.repo.openJobs(tx);
      return {
        jobs: open,
        stops: await this.repo.stops(
          tx,
          open.map((job) => job.jobId),
        ),
      };
    });
    return {
      shopPin: point(shop.latitude, shop.longitude),
      jobs: jobs.map((job) => ({
        ...job,
        stops: stops
          .filter((stop) => stop.jobId === job.jobId)
          .map(({ orderId, position, latitude, longitude, delivered }) => ({
            orderId,
            position,
            pin: point(latitude, longitude),
            delivered,
          })),
      })),
    };
  }
}
