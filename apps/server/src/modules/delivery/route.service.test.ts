import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { straightLineRoute } from './distance.domain';
import type { Coordinates } from './location.domain';
import { RouteService, type RoadRouter } from './route.service';

const shop = { latitude: 9.0108, longitude: 38.7613 };
const customer = { latitude: 8.9970566, longitude: 38.7866129 };
/** About 30 m away, inside the same resolution-9 cell. */
const neighbor = { latitude: 8.99725, longitude: 38.78655 };

function routesWith(router: RoadRouter) {
  const clock = { time: 0 };
  const service = new RouteService(router, pino({ level: 'silent' }), () => new Date(clock.time));
  return { service, clock };
}

function recordingRouter() {
  const destinations: Coordinates[] = [];
  const router: RoadRouter = {
    route: (_from, to) => {
      destinations.push(to);
      return Promise.resolve({ meters: 4874, seconds: 702 });
    },
    matrix: (points) => {
      destinations.push(...points);
      return Promise.resolve({ meters: [[0]], seconds: [[0]] });
    },
  };
  return { router, destinations };
}

describe('RouteService', () => {
  it('routes to the center of the destination zone, not to the exact pin', async () => {
    const { router, destinations } = recordingRouter();
    const route = await routesWith(router).service.between(shop, customer);
    expect(route).toEqual({ meters: 4874, seconds: 702, approximate: false });
    expect(destinations[0]).not.toEqual(customer);
    expect(destinations[0]?.latitude).toBeCloseTo(customer.latitude, 2);
    expect(destinations[0]?.longitude).toBeCloseTo(customer.longitude, 2);
  });

  it('reuses a route for 24 hours for pins in the same zone', async () => {
    const { router, destinations } = recordingRouter();
    const { service, clock } = routesWith(router);
    await service.between(shop, customer);
    await service.between(shop, neighbor);
    expect(destinations).toHaveLength(1);

    clock.time = 24 * 60 * 60 * 1000;
    await service.between(shop, neighbor);
    expect(destinations).toHaveLength(2);
  });

  it('keeps routes from different shops apart', async () => {
    const { router, destinations } = recordingRouter();
    const { service } = routesWith(router);
    await service.between(shop, customer);
    await service.between({ latitude: 9.03, longitude: 38.74 }, customer);
    expect(destinations).toHaveLength(2);
  });

  it('falls back to the straight-line estimate, flagged approximate, and does not cache it', async () => {
    let calls = 0;
    const { service } = routesWith({
      route: () => {
        calls += 1;
        return Promise.reject(new Error('OpenRouteService answered 429'));
      },
      matrix: () => Promise.reject(new Error('unused')),
    });
    await expect(service.between(shop, customer)).resolves.toEqual(
      straightLineRoute(shop, customer),
    );
    await service.between(shop, customer);
    expect(calls).toBe(2);
  });

  it('asks for a matrix from the shop to the zone centers, not the exact pins', async () => {
    const { router, destinations } = recordingRouter();
    await routesWith(router).service.matrix(shop, [customer]);
    expect(destinations[0]).toEqual(shop);
    expect(destinations[1]).not.toEqual(customer);
    expect(destinations[1]?.latitude).toBeCloseTo(customer.latitude, 2);
  });

  it('estimates the matrix from straight lines when the routing service fails', async () => {
    const { service } = routesWith({
      route: () => Promise.reject(new Error('unused')),
      matrix: () => Promise.reject(new Error('OpenRouteService answered 429')),
    });
    const matrix = await service.matrix(shop, [customer]);
    const estimate = straightLineRoute(shop, customer);
    expect(matrix.meters).toEqual([
      [0, estimate.meters],
      [estimate.meters, 0],
    ]);
    expect(matrix.seconds[0]?.[1]).toBe(estimate.seconds);
  });
});
