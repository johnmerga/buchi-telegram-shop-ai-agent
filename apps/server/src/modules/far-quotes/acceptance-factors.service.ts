import { Money } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { learnFactors, lookupFactor, type FactorLookup } from '../delivery/factors.domain';
import { acceptanceFactorZones, type PastTrip, type SyntheticFarTrip } from './far-quotes.domain';
import type { FarQuoteRow, FarQuotesRepo } from './far-quotes.repo';

/** Older trips weigh less than 1/4000 of a new one, so they no longer change a factor. */
const LEARNING_WINDOW_MS = 365 * 24 * 60 * 60_000;

// A type alias, not an interface, so it fits the jobs' `Record<string, number>` summary type.
export type AcceptanceLearningSummary = {
  shops: number;
  acceptanceZones: number;
};

/**
 * Each shop's acceptance factors: how much more than the formula payout its drivers accept for far
 * trips, per H3 resolution-6 zone and for the shop as a whole.
 */
export class AcceptanceFactorService {
  constructor(
    private readonly db: Database,
    private readonly repo: FarQuotesRepo,
    private readonly now: () => Date,
  ) {}

  /** The factor of the trip's larger zone, then the shop's, then 1. */
  lookup(shopId: string, zone: string): Promise<FactorLookup> {
    const zones = acceptanceFactorZones(zone);
    return withShop(this.db, shopId, async (tx) => {
      const rows = await this.repo.factors(tx, zones);
      return lookupFactor(zones, new Map(rows.map((row) => [row.zone, row])));
    });
  }

  /** Every far trip a driver held in the last year, as evidence for a new estimate. */
  pastTrips(shopId: string): Promise<PastTrip[]> {
    return withShop(this.db, shopId, async (tx) =>
      heldTrips(await this.repo.held(tx, this.since())),
    );
  }

  /** The nightly learning for every shop with held far trips. */
  async learnAll(): Promise<AcceptanceLearningSummary> {
    const summary: AcceptanceLearningSummary = { shops: 0, acceptanceZones: 0 };
    for (const shopId of await this.repo.shopIds(this.db)) {
      summary.shops += 1;
      summary.acceptanceZones += await this.learn(shopId);
    }
    return summary;
  }

  async addSynthetic(shopId: string, trips: SyntheticFarTrip[]): Promise<void> {
    await withShop(this.db, shopId, (tx) =>
      this.repo.insertMany(
        tx,
        trips.map(({ firstPrice, at, ...trip }) => ({
          ...trip,
          expectedSeconds: trip.routingSeconds,
          shopId,
          status: 'accepted' as const,
          proposedPrice: firstPrice,
          source: 'statistics' as const,
          synthetic: true,
          createdAt: at,
          updatedAt: at,
        })),
      ),
    );
  }

  private async learn(shopId: string): Promise<number> {
    const now = this.now();
    return withShop(this.db, shopId, async (tx) => {
      const learned = learnFactors(
        heldTrips(await this.repo.held(tx, this.since())).map((trip) => ({
          ratio: Number(trip.heldPrice.toString()) / Number(trip.formulaPayout.toString()),
          at: trip.at,
          zones: acceptanceFactorZones(trip.zone).reverse(),
        })),
        now,
      );
      await this.repo.saveFactors(tx, shopId, learned);
      return learned.length;
    });
  }

  private since(): Date {
    return new Date(this.now().getTime() - LEARNING_WINDOW_MS);
  }
}

function heldTrips(rows: FarQuoteRow[]): PastTrip[] {
  return rows.flatMap((row) =>
    row.heldPrice === null
      ? []
      : [
          {
            id: row.id,
            zone: row.zone,
            routeMeters: row.routeMeters,
            formulaPayout: Money.of(row.formulaPayout),
            heldPrice: Money.of(row.heldPrice),
            raises: row.raises,
            at: row.createdAt,
            synthetic: row.synthetic,
          },
        ],
  );
}
