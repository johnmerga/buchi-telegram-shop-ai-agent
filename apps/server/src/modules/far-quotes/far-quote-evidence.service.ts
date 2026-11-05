import type { AreaNoteService } from '../delivery/area-notes.service';
import type { FarTrip } from '../delivery/delivery.service';
import type { Coordinates } from '../delivery/location.domain';
import type { ZoneFactorService } from '../delivery/zone-factors.service';
import { parentZone, zoneOf } from '../delivery/zones.domain';
import type { AcceptanceFactorService } from './acceptance-factors.service';
import { similarTrips, type FactorBasis, type FarPriceEvidence } from './far-quotes.domain';

/** The design doc's evidence: the five most similar past trips. */
const SIMILAR_TRIPS = 5;
const DAY_MS = 24 * 60 * 60_000;

/** Collects the evidence for a far-area price from the learned factors and past trips. */
export class FarQuoteEvidence {
  constructor(
    private readonly timeFactors: Pick<ZoneFactorService, 'timeFactorDetail'>,
    private readonly acceptance: Pick<AcceptanceFactorService, 'lookup' | 'pastTrips'>,
    private readonly notes: Pick<AreaNoteService, 'near'>,
    private readonly now: () => Date,
  ) {}

  async build(shopId: string, destination: Coordinates, trip: FarTrip): Promise<FarPriceEvidence> {
    const zone = zoneOf(destination);
    const [time, acceptance, past, notes] = await Promise.all([
      this.timeFactors.timeFactorDetail(destination),
      this.acceptance.lookup(shopId, zone),
      this.acceptance.pastTrips(shopId),
      this.notes.near(shopId, destination),
    ]);
    const routingSeconds = trip.legs.reduce((sum, leg) => sum + leg.routingSeconds, 0);
    // Each lookup ends at its broadest zone: the whole city for time, the whole shop for prices.
    const basis = (from: string | null, broadest: FactorBasis): FactorBasis => {
      if (from === null) return 'none';
      if (from === zone) return 'zone';
      return from === parentZone(zone) ? 'area' : broadest;
    };
    return {
      routeMeters: trip.meters,
      routingMinutes: Math.round(routingSeconds / 60),
      approximate: trip.approximate,
      formulaPayout: trip.payout,
      timeFactor: {
        value: time.factor,
        trips: time.trips,
        band: time.band,
        basis: basis(time.from, 'city'),
      },
      acceptanceFactor: {
        value: acceptance.factor,
        trips: acceptance.trips,
        basis: basis(acceptance.from, 'shop'),
      },
      similarTrips: similarTrips({ zone, routeMeters: trip.meters }, past, SIMILAR_TRIPS).map(
        (similar) => ({ ...similar, daysAgo: this.daysAgo(similar.at) }),
      ),
      areaNotes: notes.map((note) => ({
        id: note.id,
        note: note.note,
        daysAgo: this.daysAgo(note.createdAt),
      })),
    };
  }

  private daysAgo(at: Date): number {
    return Math.max(0, Math.floor((this.now().getTime() - at.getTime()) / DAY_MS));
  }
}
