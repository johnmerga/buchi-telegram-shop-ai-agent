import { Money, type DeliverySettings } from '@buchi/shared';
import { straightLineMeters, straightLineRoute } from '../delivery/distance.domain';
import { deliveryArea, driverPayout } from '../delivery/fees.domain';
import type { Coordinates } from '../delivery/location.domain';

const MINUTE_MS = 60_000;
const KM_PER_DEGREE = 111.195;

/**
 * The scenarios that put a shop into a starting state. The real timers and events then wake the
 * real agents, so nothing inside an agent is faked.
 */
export const scenarioNames = [
  'late-delivery',
  'customer-silent',
  'far-over-cap',
  'restock-waitlist',
] as const;
export type ScenarioName = (typeof scenarioNames)[number];

/** Where the scenario order goes: about 4 km east of the shop, inside the standard range. */
export function scenarioPin(origin: Coordinates): Coordinates {
  return offsetEast(origin, 4);
}

/**
 * The times of a trip on the road. A late trip was picked up so long ago that its late check is
 * due now; any other trip was picked up a few minutes ago, so its check is still ahead.
 */
export function roadTimes(
  now: Date,
  estimatedMinutes: number,
  late: boolean,
  graceMinutes: number,
): { createdAt: Date; acceptedAt: Date; pickedUpAt: Date } {
  const onRoad = late ? estimatedMinutes + graceMinutes + 1 : 3;
  const pickedUpAt = new Date(now.getTime() - onRoad * MINUTE_MS);
  return {
    createdAt: new Date(pickedUpAt.getTime() - 40 * MINUTE_MS),
    acceptedAt: new Date(pickedUpAt.getTime() - 15 * MINUTE_MS),
    pickedUpAt,
  };
}

/**
 * A spot for the customer to share in the chat whose formula payout is well above the far cap,
 * so the far price needs the owner. It walks east from the shop, inside the far range, until the
 * payout clears the cap by a quarter. Undefined when the far range ends before that.
 */
export function overCapSpot(
  origin: Coordinates,
  settings: DeliverySettings,
): { point: Coordinates; km: number; payout: string } | undefined {
  // A quarter above the cap, so the real road route and traffic cannot bring it under.
  const clearlyAbove = Money.of(settings.farCap).times(5).divideRoundingUp(4);
  for (let km = settings.standardRangeKm; km <= settings.farRangeKm; km += 0.5) {
    const point = offsetEast(origin, km / 1.4);
    const route = straightLineRoute(origin, point);
    if (deliveryArea(route.meters, settings) !== 'far') continue;
    const payout = driverPayout(route, 1, settings);
    if (payout.compare(clearlyAbove) > 0) {
      return {
        point,
        km: Math.round(straightLineMeters(origin, point) / 100) / 10,
        payout: payout.toString(),
      };
    }
  }
  return undefined;
}

function offsetEast(point: Coordinates, km: number): Coordinates {
  const longitude =
    point.longitude + km / (KM_PER_DEGREE * Math.cos((point.latitude * Math.PI) / 180));
  return { latitude: point.latitude, longitude };
}
