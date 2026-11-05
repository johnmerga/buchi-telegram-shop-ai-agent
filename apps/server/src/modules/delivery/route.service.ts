import { cellToLatLng, latLngToCell } from 'h3-js';
import type { Logger } from 'pino';
import { TtlCache } from '../../shared/ttl-cache';
import { straightLineMatrix, straightLineRoute, type Route } from './distance.domain';
import type { Coordinates } from './location.domain';

/** Road meters and seconds from each point (row) to each point (column). */
export interface TravelMatrix {
  meters: number[][];
  seconds: number[][];
}

/** A road routing service. OpenRouteService is the only implementation. */
export interface RoadRouter {
  route(from: Coordinates, to: Coordinates): Promise<{ meters: number; seconds: number }>;
  matrix(points: Coordinates[]): Promise<TravelMatrix>;
}

/**
 * H3 resolution 9 cells average 0.1 km² with edges of about 200 m, so routing to the cell's center
 * changes a trip by a few hundred meters at most, while nearby customers share one cached route.
 */
const ZONE_RESOLUTION = 9;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_ROUTES = 5000;

/** Road trips from a shop, cached for 24 hours per destination zone to stay inside the free quota. */
export class RouteService {
  private readonly cache: TtlCache<Route>;

  constructor(
    private readonly router: RoadRouter,
    private readonly logger: Logger,
    now: () => Date,
  ) {
    this.cache = new TtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: MAX_CACHED_ROUTES, now });
  }

  /**
   * Routes to the center of the destination's zone, which also keeps the customer's exact pin away
   * from the routing service. Without a road route it estimates from the straight line and says so.
   */
  async between(origin: Coordinates, destination: Coordinates): Promise<Route> {
    const zone = latLngToCell(destination.latitude, destination.longitude, ZONE_RESOLUTION);
    const key = `${String(origin.latitude)},${String(origin.longitude)}:${zone}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    try {
      const road = await this.router.route(origin, zoneCenter(destination));
      const route = { ...road, approximate: false };
      this.cache.set(key, route);
      return route;
    } catch (err) {
      this.logger.warn({ err }, 'road route unavailable, using the straight-line estimate');
      return straightLineRoute(origin, destination);
    }
  }

  /**
   * Travel between the shop (row and column 0) and each destination, for ordering a Saver route.
   * Destinations go to their zone centers like single routes. Without road data it estimates every
   * pair from the straight line.
   */
  async matrix(origin: Coordinates, destinations: Coordinates[]): Promise<TravelMatrix> {
    try {
      return await this.router.matrix([origin, ...destinations.map(zoneCenter)]);
    } catch (err) {
      this.logger.warn({ err }, 'road matrix unavailable, using straight-line estimates');
      return straightLineMatrix([origin, ...destinations]);
    }
  }
}

function zoneCenter(point: Coordinates): Coordinates {
  const [latitude, longitude] = cellToLatLng(
    latLngToCell(point.latitude, point.longitude, ZONE_RESOLUTION),
  );
  return { latitude, longitude };
}
