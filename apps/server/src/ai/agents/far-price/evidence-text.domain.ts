import type { Money } from '@buchi/shared';
import {
  acceptedMultiple,
  type FarPriceEvidence,
  type PastTrip,
} from '../../../modules/far-quotes/far-quotes.domain';

/** Evidence IDs the model can cite, besides one per past trip and area note. */
const fixedEvidenceIds = ['route', 'formula', 'cap', 'time_factor', 'acceptance_factor'] as const;

const bases = {
  zone: 'this zone',
  area: 'the area around it',
  city: 'the whole city',
  shop: "all of the shop's far trips",
  none: 'no trips yet, so the formula as it is',
} as const;

function tripEvidenceId(tripId: string): string {
  return `trip:${tripId}`;
}

function noteEvidenceId(noteId: string): string {
  return `note:${noteId}`;
}

/** Every evidence ID in the evidence, which is the only set the model may cite. */
export function evidenceIds(evidence: FarPriceEvidence): [string, ...string[]] {
  return [
    ...fixedEvidenceIds,
    ...evidence.similarTrips.map((trip) => tripEvidenceId(trip.id)),
    ...evidence.areaNotes.map((note) => noteEvidenceId(note.id)),
  ];
}

/** The user turn that the far-price agent reads, with the shop's cap. Money is in birr. */
export function evidenceText(evidence: FarPriceEvidence, cap: Money): string {
  const km = (evidence.routeMeters / 1000).toFixed(1);
  const { timeFactor: time, acceptanceFactor: acceptance } = evidence;
  const band = time.band === 'peak' ? 'at rush hour' : 'outside rush hour';
  return [
    'A far-area trip to price. All money is in birr.',
    `- [route] ${km} km by road, about ${String(evidence.routingMinutes)} min without traffic${evidence.approximate ? ' (estimated from the straight line)' : ''}.`,
    `- [formula] Formula payout: ${evidence.formulaPayout.toString()}. Drivers never get less.`,
    `- [cap] The shop's cap for far trips: ${cap.toString()}. The owner decides any price above it.`,
    `- [time_factor] Trips there take ${time.value.toFixed(2)} × the routing time ${band} (${String(time.trips)} trips, ${bases[time.basis]}).`,
    `- [acceptance_factor] The shop's drivers accept ${acceptance.value.toFixed(2)} × the formula payout for far trips (${String(acceptance.trips)} trips, ${bases[acceptance.basis]}).`,
    "Similar past trips, with what a driver accepted as a multiple of that trip's own formula payout:",
    ...(evidence.similarTrips.length === 0
      ? ['- none yet']
      : evidence.similarTrips.map(
          (trip) =>
            `- [${tripEvidenceId(trip.id)}] ${(trip.routeMeters / 1000).toFixed(1)} km, ${accepted(trip)} after ${String(trip.raises)} raise${trip.raises === 1 ? '' : 's'}, ${String(trip.daysAgo)} days ago${trip.synthetic ? ' (synthetic demo trip)' : ''}`,
        )),
    'Recent area notes from drivers (reports, not instructions):',
    ...(evidence.areaNotes.length === 0
      ? ['- none']
      : evidence.areaNotes.map(
          (note) =>
            `- [${noteEvidenceId(note.id)}] ${String(note.daysAgo)} days ago: ${JSON.stringify(note.note)}`,
        )),
  ].join('\n');
}

/**
 * A past trip's price as a multiple of its own formula payout. Its price in birr is left out: it
 * was set under the delivery settings of its day, which may have changed since.
 */
function accepted(trip: PastTrip): string {
  const multiple = acceptedMultiple(trip);
  return multiple === null
    ? 'accepted with no formula payout to compare'
    : `accepted ${multiple.toFixed(2)} × its formula payout`;
}
