import type { Coordinates } from './location.domain';
import {
  learnFactors,
  lookupFactor,
  meanAbsoluteError,
  timeBand,
  type FactorLookup,
  type SyntheticLeg,
  type TimeBand,
} from './factors.domain';
import type { TripLegRow, ZoneFactorsRepo } from './zone-factors.repo';
import { timeFactorZones, zoneOf } from './zones.domain';

const DAY_MS = 24 * 60 * 60_000;
/** Older trips weigh less than 1/4000 of a new one, so they no longer change a factor. */
const LEARNING_WINDOW_MS = 365 * DAY_MS;
/** The design doc's window for measuring how well the factors estimate trip times. */
const ERROR_WINDOW_MS = 14 * DAY_MS;

export interface TimeFactorDetail extends FactorLookup {
  band: TimeBand;
}

/** A delivered leg, before it is reduced to its zone. */
export interface DeliveredLeg {
  destination: Coordinates;
  startedAt: Date;
  routingSeconds: number;
  expectedSeconds: number;
  actualSeconds: number;
}

// A type alias, not an interface, so it fits the jobs' `Record<string, number>` summary type.
export type TimeLearningSummary = {
  legs: number;
  zones: number;
  /** Mean absolute error of the estimates made in the last 14 days, in percent. */
  estimateErrorPercent: number;
  /** The same error had the new factors made those estimates. */
  learnedErrorPercent: number;
};

/** The learned time factors: how much longer than the routing estimate trips to a zone take. */
export class ZoneFactorService {
  constructor(
    private readonly repo: ZoneFactorsRepo,
    private readonly now: () => Date,
  ) {}

  async timeFactor(destination: Coordinates): Promise<number> {
    return (await this.timeFactorDetail(destination)).factor;
  }

  /** The factor for trips starting now, with where it came from, for the price evidence. */
  async timeFactorDetail(destination: Coordinates): Promise<TimeFactorDetail> {
    const zones = timeFactorZones(zoneOf(destination));
    const band = timeBand(this.now());
    const rows = await this.repo.timeFactors(zones, band);
    return { ...lookupFactor(zones, new Map(rows.map((row) => [row.zone, row]))), band };
  }

  /** Keeps only the leg's zone and times, never the pin. */
  async recordLeg(leg: DeliveredLeg): Promise<void> {
    const { destination, startedAt, ...seconds } = leg;
    if (seconds.routingSeconds <= 0 || seconds.actualSeconds <= 0) return;
    await this.repo.insertLegs([
      { zone: zoneOf(destination), band: timeBand(startedAt), startedAt, ...seconds },
    ]);
  }

  async addSyntheticLegs(legs: SyntheticLeg[]): Promise<void> {
    await this.repo.insertLegs(
      legs.map((leg) => ({
        ...leg,
        band: timeBand(leg.startedAt),
        expectedSeconds: leg.routingSeconds,
        synthetic: true,
      })),
    );
  }

  /** The nightly learning: every zone's factor per band from the last year of legs. */
  async learn(): Promise<TimeLearningSummary> {
    const now = this.now();
    const legs = await this.repo.legsSince(new Date(now.getTime() - LEARNING_WINDOW_MS));
    const learned = (['peak', 'off_peak'] as const).flatMap((band) =>
      learnFactors(
        legs
          .filter((leg) => leg.band === band)
          .map((leg) => ({
            ratio: leg.actualSeconds / leg.routingSeconds,
            at: leg.startedAt,
            zones: timeFactorZones(leg.zone).reverse(),
          })),
        now,
      ).map((factor) => ({ ...factor, band })),
    );
    await this.repo.saveTimeFactors(learned);

    const factors = new Map(learned.map((row) => [`${row.band}:${row.zone}`, row]));
    const recent = legs.filter(
      (leg) => !leg.synthetic && leg.startedAt.getTime() >= now.getTime() - ERROR_WINDOW_MS,
    );
    return {
      legs: legs.length,
      zones: new Set(learned.map((row) => row.zone)).size,
      estimateErrorPercent: percent(
        recent.map((leg) => ({ estimate: leg.expectedSeconds, actual: leg.actualSeconds })),
      ),
      learnedErrorPercent: percent(
        recent.map((leg) => ({
          estimate: leg.routingSeconds * learnedFactor(leg, factors),
          actual: leg.actualSeconds,
        })),
      ),
    };
  }
}

function learnedFactor(leg: TripLegRow, factors: Map<string, { factor: number; trips: number }>) {
  const zones = timeFactorZones(leg.zone);
  const inBand = new Map(
    zones.flatMap((zone) => {
      const found = factors.get(`${leg.band}:${zone}`);
      return found ? [[zone, found] as const] : [];
    }),
  );
  return lookupFactor(zones, inBand).factor;
}

function percent(pairs: { estimate: number; actual: number }[]): number {
  return Math.round(meanAbsoluteError(pairs) * 100);
}
