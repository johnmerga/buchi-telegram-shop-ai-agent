import { latLngToCell } from 'h3-js';
import type { Coordinates } from './location.domain';

/**
 * H3 resolution 7 cells cover about 5 km², roughly one Addis Ababa neighbourhood such as
 * Megenagna, which is the scale at which a closed road or a jam matters to other trips.
 */
const NOTE_ZONE_RESOLUTION = 7;

/** The zone a note about this point belongs to. */
export function noteZone(point: Coordinates): string {
  return latLngToCell(point.latitude, point.longitude, NOTE_ZONE_RESOLUTION);
}
