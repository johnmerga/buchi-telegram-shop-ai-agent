import type { Coordinates } from './location.domain';

/** A trip by road. `approximate` means it comes from the straight line, not a road route. */
export interface Route {
  meters: number;
  seconds: number;
  approximate: boolean;
}

const EARTH_RADIUS_M = 6_371_000;
/** Roads in Addis Ababa are about 1.4 times longer than the straight line between two points. */
const ROAD_DETOUR = 1.4;
/** A typical motorbike speed across Addis Ababa without traffic, used only without a road route. */
const FALLBACK_SPEED_KMH = 25;

/** The great-circle distance in meters (haversine formula). */
export function straightLineMeters(from: Coordinates, to: Coordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(to.latitude - from.latitude);
  const dLng = radians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Estimates a road trip from the straight line when the routing service cannot answer. */
export function straightLineRoute(from: Coordinates, to: Coordinates): Route {
  const meters = Math.round(straightLineMeters(from, to) * ROAD_DETOUR);
  const seconds = Math.round((meters / 1000 / FALLBACK_SPEED_KMH) * 3600);
  return { meters, seconds, approximate: true };
}
