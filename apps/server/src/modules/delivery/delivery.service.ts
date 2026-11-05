import type { DeliverySettings } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { ShopsService } from '../shops/shops.service';
import type { DeliverySettingsRepo } from './delivery-settings.repo';
import type { Route } from './distance.domain';
import { quoteDelivery, tripCost, type DeliveryQuote, type TripCost } from './fees.domain';
import type { Coordinates } from './location.domain';
import type { RouteService } from './route.service';

/**
 * How much longer than the routing estimate trips to a destination take. Task 5.5 learns it per
 * zone. Until then every zone uses 1.
 */
export type TimeFactor = (destination: Coordinates) => Promise<number>;

export class DeliveryService {
  constructor(
    private readonly db: Database,
    private readonly settings: DeliverySettingsRepo,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly routes: Pick<RouteService, 'between'>,
    private readonly timeFactor: TimeFactor,
  ) {}

  async saveSettings(shopId: string, settings: DeliverySettings): Promise<void> {
    await withShop(this.db, shopId, (tx) => this.settings.save(tx, shopId, settings));
  }

  /** A shop delivers once it has both its location and its delivery settings. */
  async offersDelivery(shopId: string): Promise<boolean> {
    return (await this.pricing(shopId)) !== undefined;
  }

  /** The delivery options to a destination, or nothing when the shop offers pickup only. */
  async quote(shopId: string, destination: Coordinates): Promise<DeliveryQuote | undefined> {
    const pricing = await this.pricing(shopId);
    if (!pricing) return undefined;
    const { route, timeFactor } = await this.roadTo(pricing.origin, destination);
    return quoteDelivery(route, timeFactor, pricing.settings);
  }

  /** The formula payout for a trip from the shop to one destination. */
  async tripTo(shopId: string, destination: Coordinates): Promise<TripCost | undefined> {
    const pricing = await this.pricing(shopId);
    if (!pricing) return undefined;
    const { route, timeFactor } = await this.roadTo(pricing.origin, destination);
    return tripCost(
      [{ meters: route.meters, seconds: route.seconds, timeFactor }],
      pricing.settings,
    );
  }

  /**
   * The formula payout for one trip through every stop in order. Each stop carries the road leg
   * that ends at it, and its zone sets that leg's time factor.
   */
  async tripThrough(
    shopId: string,
    stops: { destination: Coordinates; meters: number; seconds: number }[],
  ): Promise<TripCost | undefined> {
    const pricing = await this.pricing(shopId);
    if (!pricing) return undefined;
    const legs = await Promise.all(
      stops.map(async (stop) => ({
        meters: stop.meters,
        seconds: stop.seconds,
        timeFactor: await this.timeFactor(stop.destination),
      })),
    );
    return tripCost(legs, pricing.settings);
  }

  private async roadTo(
    origin: Coordinates,
    destination: Coordinates,
  ): Promise<{ route: Route; timeFactor: number }> {
    const [route, timeFactor] = await Promise.all([
      this.routes.between(origin, destination),
      this.timeFactor(destination),
    ]);
    return { route, timeFactor };
  }

  private async pricing(
    shopId: string,
  ): Promise<{ origin: Coordinates; settings: DeliverySettings } | undefined> {
    const [shop, settings] = await Promise.all([
      this.shops.get(shopId),
      withShop(this.db, shopId, (tx) => this.settings.find(tx)),
    ]);
    if (shop.latitude === null || shop.longitude === null || !settings) return undefined;
    return { origin: { latitude: shop.latitude, longitude: shop.longitude }, settings };
  }
}
