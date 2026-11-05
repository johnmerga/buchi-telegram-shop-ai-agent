import { cellToLatLng, cellToParent, latLngToCell } from 'h3-js';
import type { Coordinates } from './location.domain';

/** H3 resolution 7 cells cover about 5 km², small enough for one neighbourhood's traffic. */
const ZONE_RESOLUTION = 7;
/** Resolution 6 parents cover about 36 km², for areas with few trips. */
const PARENT_RESOLUTION = 6;
/** The zone that holds every trip, so a place without nearby trips still gets the city's traffic. */
const CITY_ZONE = 'all';

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

/** Where a time factor is learned and looked up: the zone, its parent, then the whole city. */
export function timeFactorZones(zone: string): string[] {
  return [zone, parentZone(zone), CITY_ZONE];
}
