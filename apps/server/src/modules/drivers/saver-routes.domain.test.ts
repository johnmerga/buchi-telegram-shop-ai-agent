import { describe, expect, it } from 'vitest';
import {
  bearing,
  MAX_ROUTE_SECONDS,
  MAX_STOPS,
  nearestNeighbor,
  planRoutes,
  routeLegs,
  routeSeconds,
  sweepGroups,
  twoOpt,
} from './saver-routes.domain';

const shop = { latitude: 9.0108, longitude: 38.7613 };

/** A stop about `km` kilometers from the shop in the direction `degrees` clockwise from north. */
function stopAt(id: string, degrees: number, km = 3) {
  const radians = (degrees * Math.PI) / 180;
  const degreesPerKm = 1 / 111;
  return {
    id,
    point: {
      latitude: shop.latitude + Math.cos(radians) * km * degreesPerKm,
      longitude:
        shop.longitude +
        (Math.sin(radians) * km * degreesPerKm) / Math.cos((shop.latitude * Math.PI) / 180),
    },
  };
}

/** A deterministic pseudo-random travel-time matrix, so failures can be reproduced. */
function randomMatrix(size: number, seed: number): number[][] {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return 60 + (state % 1200);
  };
  return Array.from({ length: size }, (_, from) =>
    Array.from({ length: size }, (_, to) => (from === to ? 0 : next())),
  );
}

describe('bearing', () => {
  it('measures clockwise from north', () => {
    expect(bearing(shop, stopAt('n', 0).point)).toBeCloseTo(0, 0);
    expect(bearing(shop, stopAt('e', 90).point)).toBeCloseTo(90, 0);
    expect(bearing(shop, stopAt('s', 180).point)).toBeCloseTo(180, 0);
    expect(bearing(shop, stopAt('w', 270).point)).toBeCloseTo(270, 0);
  });
});

describe('sweepGroups', () => {
  it('cuts seven stops into two groups of at most six', () => {
    const stops = [10, 40, 80, 130, 200, 250, 300].map((d) => stopAt(`s${String(d)}`, d));
    const groups = sweepGroups(shop, stops);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.length)).toEqual([4, 3]);
  });

  it('never puts more than six stops in a group', () => {
    const stops = Array.from({ length: 20 }, (_, i) => stopAt(`s${String(i)}`, i * 17));
    const groups = sweepGroups(shop, stops);
    expect(groups).toHaveLength(4);
    for (const group of groups) expect(group.length).toBeLessThanOrEqual(MAX_STOPS);
    expect(
      groups
        .flat()
        .map((s) => s.id)
        .sort(),
    ).toEqual(stops.map((s) => s.id).sort());
  });

  it('keeps stops on both sides of north in one group', () => {
    const stops = [350, 355, 5, 10, 170, 180, 190, 200].map((d) => stopAt(`s${String(d)}`, d));
    const groups = sweepGroups(shop, stops).map((g) => g.map((s) => s.id));
    expect(groups).toEqual([
      ['s170', 's180', 's190', 's200'],
      ['s350', 's355', 's5', 's10'],
    ]);
  });

  it('orders stops in the same direction from near to far', () => {
    // Due north, so both directions are exactly equal.
    const groups = sweepGroups(shop, [stopAt('far', 0, 6), stopAt('near', 0, 2)]);
    expect(groups[0]?.map((s) => s.id)).toEqual(['near', 'far']);
  });

  it('returns the same groups whatever order the stops come in', () => {
    const stops = Array.from({ length: 9 }, (_, i) => stopAt(`s${String(i)}`, (i * 97) % 360));
    expect(sweepGroups(shop, [...stops].reverse())).toEqual(sweepGroups(shop, stops));
  });

  it('returns no groups without stops', () => {
    expect(sweepGroups(shop, [])).toEqual([]);
  });
});

describe('nearestNeighbor', () => {
  it('always drives to the closest stop not yet visited', () => {
    const seconds = [
      [0, 300, 100, 500],
      [300, 0, 200, 100],
      [100, 200, 0, 400],
      [500, 100, 400, 0],
    ];
    expect(nearestNeighbor(seconds, [1, 2, 3])).toEqual([2, 1, 3]);
  });
});

describe('twoOpt', () => {
  it('untangles a crossing route', () => {
    // Stops on a line at 1, 2, 3, and 4 minutes from the shop, visited out of order.
    const at = [0, 1, 2, 3, 4];
    const seconds = at.map((a) => at.map((b) => Math.abs(a - b) * 60));
    expect(twoOpt(seconds, [1, 3, 2, 4])).toEqual([1, 2, 3, 4]);
  });

  it('never makes a route longer', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const seconds = randomMatrix(7, seed);
      const start = nearestNeighbor(seconds, [1, 2, 3, 4, 5, 6]);
      const improved = twoOpt(seconds, start);
      expect(routeSeconds(seconds, improved)).toBeLessThanOrEqual(routeSeconds(seconds, start));
      expect([...improved].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it('never makes a route longer than any starting order', () => {
    const seconds = randomMatrix(6, 42);
    const start = [5, 1, 4, 2, 3];
    expect(routeSeconds(seconds, twoOpt(seconds, start))).toBeLessThanOrEqual(
      routeSeconds(seconds, start),
    );
  });
});

describe('planRoutes', () => {
  it('visits every stop once, in one route when it fits the time limit', () => {
    const at = [0, 3, 1, 2];
    const seconds = at.map((a) => at.map((b) => Math.abs(a - b) * 300));
    expect(planRoutes(seconds)).toEqual([[2, 3, 1]]);
  });

  it('starts a new route from the shop when a route would run too long', () => {
    // Each stop is 50 minutes from the shop and from every other stop.
    const seconds = Array.from({ length: 4 }, (_, from) =>
      Array.from({ length: 4 }, (_, to) => (from === to ? 0 : 50 * 60)),
    );
    const routes = planRoutes(seconds);
    expect(routes).toEqual([[1], [2], [3]]);
    for (const route of routes) {
      expect(route.length === 1 || routeSeconds(seconds, route) <= MAX_ROUTE_SECONDS).toBe(true);
    }
  });

  it('gives a stop beyond the time limit a route of its own', () => {
    const seconds = [
      [0, 2 * 60 * 60, 600],
      [2 * 60 * 60, 0, 2 * 60 * 60],
      [600, 2 * 60 * 60, 0],
    ];
    expect(planRoutes(seconds)).toEqual([[2], [1]]);
  });

  it('plans the same routes for the same matrix', () => {
    const seconds = randomMatrix(7, 7);
    expect(planRoutes(seconds)).toEqual(planRoutes(seconds));
  });
});

describe('routeLegs', () => {
  it('starts at the shop and follows the route', () => {
    const matrix = {
      meters: [
        [0, 1000, 2000, 3000],
        [1100, 0, 1200, 1300],
        [2100, 2200, 0, 2300],
        [3100, 3200, 3300, 0],
      ],
      seconds: [
        [0, 100, 200, 300],
        [110, 0, 120, 130],
        [210, 220, 0, 230],
        [310, 320, 330, 0],
      ],
    };
    expect(routeLegs(matrix, [3, 1, 2])).toEqual([
      { to: 3, meters: 3000, seconds: 300 },
      { to: 1, meters: 3200, seconds: 320 },
      { to: 2, meters: 1200, seconds: 120 },
    ]);
  });

  it('rejects a stop outside the matrix', () => {
    expect(() => routeLegs({ meters: [[0]], seconds: [[0]] }, [1])).toThrow(RangeError);
  });
});
