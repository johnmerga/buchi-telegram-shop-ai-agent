import type { Coordinates } from '../delivery/location.domain';

/** The design doc's limit on stops in one Saver route. */
export const MAX_STOPS = 6;

/** A route ends before it would take longer than this, so its last stops still arrive in time. */
export const MAX_ROUTE_SECONDS = 90 * 60;

export interface SweepStop {
  id: string;
  point: Coordinates;
}

/** The compass direction from `from` to `to`, in degrees clockwise from north, from 0 up to 360. */
export function bearing(from: Coordinates, to: Coordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLng = radians(to.longitude - from.longitude);
  const y = Math.sin(dLng) * Math.cos(radians(to.latitude));
  const x =
    Math.cos(radians(from.latitude)) * Math.sin(radians(to.latitude)) -
    Math.sin(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Sorts stops clockwise by direction from the shop and cuts them into as few groups of at most
 * `MAX_STOPS` as possible, of nearly equal size. The sweep starts after the widest empty angle, so
 * stops in one direction are not split just because they lie on both sides of north.
 */
export function sweepGroups<T extends SweepStop>(origin: Coordinates, stops: T[]): T[][] {
  const sorted = stops
    .map((stop) => ({ stop, angle: bearing(origin, stop.point), far: squaredOffset(origin, stop) }))
    .sort((a, b) => a.angle - b.angle || a.far - b.far || a.stop.id.localeCompare(b.stop.id));
  const start = afterWidestGap(sorted.map((entry) => entry.angle));
  const swept = [...sorted.slice(start), ...sorted.slice(0, start)].map((entry) => entry.stop);

  const groupCount = Math.ceil(swept.length / MAX_STOPS);
  const groups: T[][] = [];
  let taken = 0;
  for (let group = 0; group < groupCount; group++) {
    const size = Math.ceil((swept.length - taken) / (groupCount - group));
    groups.push(swept.slice(taken, taken + size));
    taken += size;
  }
  return groups;
}

/**
 * Visiting order for stops `1…n` of a travel-time matrix whose index 0 is the shop: cut into routes
 * that each fit in `MAX_ROUTE_SECONDS` (a single farther stop still gets its own route), each
 * ordered by nearest neighbor and then 2-opt.
 */
export function planRoutes(seconds: number[][]): number[][] {
  const routes: number[][] = [];
  let remaining = orderStops(
    seconds,
    seconds.slice(1).map((_, index) => index + 1),
  );
  while (remaining.length > 0) {
    const route = prefixWithin(seconds, remaining, MAX_ROUTE_SECONDS);
    routes.push(route);
    remaining = orderStops(seconds, remaining.slice(route.length));
  }
  return routes;
}

/** Nearest neighbor from the shop, then 2-opt, which only ever shortens the route. */
function orderStops(seconds: number[][], stops: number[]): number[] {
  return twoOpt(seconds, nearestNeighbor(seconds, stops));
}

/** Starts at the shop and always drives to the closest stop not yet visited. */
export function nearestNeighbor(seconds: number[][], stops: number[]): number[] {
  const left = [...stops].sort((a, b) => a - b);
  const path: number[] = [];
  let at = 0;
  while (left.length > 0) {
    // Ties go to the lower index, which keeps the result deterministic.
    const next = left.reduce((best, stop) =>
      cell(seconds, at, stop) < cell(seconds, at, best) ? stop : best,
    );
    left.splice(left.indexOf(next), 1);
    path.push(next);
    at = next;
  }
  return path;
}

/**
 * Reverses any stretch of the route that makes it shorter, until none does. Only strict
 * improvements are kept, so the result is never longer than the input and the loop ends.
 */
export function twoOpt(seconds: number[][], path: number[]): number[] {
  let best = path;
  let bestCost = routeSeconds(seconds, path);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1),
        ];
        const cost = routeSeconds(seconds, candidate);
        if (cost < bestCost) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

/** Travel from the shop through every stop in order. The driver's way back is not paid. */
export function routeSeconds(seconds: number[][], path: number[]): number {
  return pairs(path).reduce((sum, [from, to]) => sum + cell(seconds, from, to), 0);
}

/** The road leg that ends at each stop of the route, starting from the shop. */
export function routeLegs(
  matrix: { meters: number[][]; seconds: number[][] },
  path: number[],
): { to: number; meters: number; seconds: number }[] {
  return pairs(path).map(([from, to]) => ({
    to,
    meters: cell(matrix.meters, from, to),
    seconds: cell(matrix.seconds, from, to),
  }));
}

/** The `[from, to]` matrix indices of each leg, starting at the shop. */
function pairs(path: number[]): [number, number][] {
  return path.map((to, index) => [index === 0 ? 0 : (path[index - 1] ?? 0), to]);
}

/** The longest start of the route that fits in `limit`, and always at least its first stop. */
function prefixWithin(seconds: number[][], path: number[], limit: number): number[] {
  let count = 1;
  while (count < path.length && routeSeconds(seconds, path.slice(0, count + 1)) <= limit) count++;
  return path.slice(0, count);
}

/** Index of the angle that follows the widest gap between neighbors around the circle. */
function afterWidestGap(sortedAngles: number[]): number {
  let start = 0;
  let widest = -1;
  sortedAngles.forEach((angle, index) => {
    const previous = sortedAngles.at(index - 1) ?? angle;
    const gap = (angle - previous + 360) % 360;
    if (gap > widest) {
      widest = gap;
      start = index;
    }
  });
  return start;
}

/** Orders stops in the same direction from near to far without a square root. */
function squaredOffset(origin: Coordinates, stop: SweepStop): number {
  return (
    (stop.point.latitude - origin.latitude) ** 2 + (stop.point.longitude - origin.longitude) ** 2
  );
}

function cell(matrix: number[][], from: number, to: number): number {
  const value = matrix[from]?.[to];
  if (value === undefined)
    throw new RangeError(`No travel time from ${String(from)} to ${String(to)}`);
  return value;
}
