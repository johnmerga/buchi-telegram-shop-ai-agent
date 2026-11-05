import { Money } from '@buchi/shared';
import type { Logger } from 'pino';
import type { DeliveryService } from '../delivery/delivery.service';
import type { RouteService } from '../delivery/route.service';
import type { SaverScheduleService } from '../delivery/saver-schedule.service';
import type { OrderService } from '../orders/orders.service';
import type { ShopsService } from '../shops/shops.service';
import { point } from './dispatch.domain';
import type { DispatchService } from './dispatch.service';
import { planRoutes, routeLegs, sweepGroups, type SweepStop } from './saver-routes.domain';

// A type alias, not an interface, so it fits the jobs' `Record<string, number>` summary type.
type RunSummary = {
  routes: number;
  orders: number;
};

type AllRunsSummary = RunSummary & {
  shops: number;
  failed: number;
};

/** Groups a shop's paid Saver orders into routes and offers each route to drivers as one job. */
export class SaverRunService {
  constructor(
    private readonly orders: Pick<OrderService, 'paid' | 'shopsWithPaid'>,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly routes: Pick<RouteService, 'matrix'>,
    private readonly delivery: Pick<DeliveryService, 'tripTo' | 'tripThrough'>,
    private readonly schedule: Pick<SaverScheduleService, 'claim'>,
    private readonly dispatch: Pick<DispatchService, 'createJob'>,
    private readonly logger: Logger,
  ) {}

  /** The `saver-run` job runs every shop with waiting Saver orders now, such as for the demo. */
  async runAll(): Promise<AllRunsSummary> {
    const summary: AllRunsSummary = { shops: 0, routes: 0, orders: 0, failed: 0 };
    for (const shopId of await this.orders.shopsWithPaid('saver')) {
      try {
        const run = await this.run(shopId);
        summary.shops += 1;
        summary.routes += run.routes;
        summary.orders += run.orders;
      } catch (err) {
        this.logger.error({ err, shopId }, 'Saver run failed');
        summary.failed += 1;
      }
    }
    return summary;
  }

  /** The Saver run timer handler, at one of the times the owner set. */
  async runScheduled(timer: { shopId: string | null; dueAt: Date }): Promise<void> {
    if (timer.shopId === null) throw new Error('A Saver run timer needs a shop');
    if (await this.schedule.claim(timer.shopId, timer.dueAt)) await this.run(timer.shopId);
  }

  private async run(shopId: string): Promise<RunSummary> {
    const [shop, waiting] = await Promise.all([
      this.shops.get(shopId),
      this.orders.paid(shopId, 'saver'),
    ]);
    const origin = point(shop.latitude, shop.longitude);
    if (!origin) throw new Error('A shop with Saver orders has no location');
    const stops = waiting.flatMap((order) => {
      const pin = point(order.deliveryLatitude, order.deliveryLongitude);
      return pin ? [{ id: order.id, point: pin }] : [];
    });

    const summary: RunSummary = { routes: 0, orders: 0 };
    for (const group of sweepGroups(origin, stops)) {
      const matrix = await this.routes.matrix(
        origin,
        group.map((stop) => stop.point),
      );
      for (const route of planRoutes(matrix.seconds)) {
        const legs = routeLegs(matrix, route).map((leg) => ({
          ...leg,
          stop: stopAt(group, leg.to),
        }));
        if (await this.offerRoute(shopId, legs)) {
          summary.routes += 1;
          summary.orders += legs.length;
        }
      }
    }
    return summary;
  }

  /** One job for the route, paid by the formula over the whole route. */
  private async offerRoute(
    shopId: string,
    legs: { stop: SweepStop; meters: number; seconds: number }[],
  ): Promise<boolean> {
    const [route, ...separateTrips] = await Promise.all([
      this.delivery.tripThrough(
        shopId,
        legs.map((leg) => ({
          destination: leg.stop.point,
          meters: leg.meters,
          seconds: leg.seconds,
        })),
      ),
      ...legs.map((leg) => this.delivery.tripTo(shopId, leg.stop.point)),
    ]);
    if (!route) throw new Error('The shop no longer has delivery settings');
    const separateTripsPayout = separateTrips.reduce((sum, trip) => {
      if (!trip) throw new Error('The shop no longer has delivery settings');
      return sum.add(trip.payout);
    }, Money.zero);
    return this.dispatch.createJob(shopId, {
      orderIds: legs.map((leg) => leg.stop.id),
      payout: route.payout,
      separateTripsPayout,
      routeMeters: route.meters,
      estimatedMinutes: route.expectedMinutes,
    });
  }
}

/** Matrix index `i` is the group's stop `i - 1`, because index 0 is the shop. */
function stopAt(group: SweepStop[], index: number): SweepStop {
  const stop = group[index - 1];
  if (!stop) throw new RangeError(`No stop at matrix index ${String(index)}`);
  return stop;
}
