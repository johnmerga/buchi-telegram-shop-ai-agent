import { cellToLatLng, cellToParent, gridDisk, latLngToCell } from 'h3-js';
import type { Coordinates } from './location.domain';

/** H3 resolution 7 cells cover about 5 km², small enough for one neighbourhood's traffic. */
const ZONE_RESOLUTION = 7;
/** Resolution 6 parents cover about 36 km², for areas with few trips. */
const PARENT_RESOLUTION = 6;

/** The learned-factor zone of a point. Only the zone is kept once the exact pin is deleted. */
export function zoneOf(point: Coordinates): string {
  return latLngToCell(point.latitude, point.longitude, ZONE_RESOLUTION);
}

/** The larger zone around a zone, which holds the trips of all seven of its neighbours. */
export function parentZone(zone: string): string {
  return cellToParent(zone, PARENT_RESOLUTION);
}

export function zoneCenter(zone: string): Coordinates {
  const [latitude, longitude] = cellToLatLng(zone);
  return { latitude, longitude };
}

/** The zone and the six zones around it, for reports about roads just across a zone's edge. */
export function nearbyZones(zone: string): string[] {
  return gridDisk(zone, 1);
}
