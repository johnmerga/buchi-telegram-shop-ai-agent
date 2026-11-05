/** One trip can be very unusual, so each ratio counts at most this far from the formula. */
const MIN_RATIO = 0.5;
const MAX_RATIO = 4;
/** How many trips a zone needs before its own data outweighs its parent's factor. */
const SHRINKAGE_TRIPS = 5;
/** A trip weighs half as much after 30 days, a quarter after 60 days, and so on. */
const HALF_LIFE_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

/** Addis Ababa keeps UTC+3 all year, without daylight saving time. */
const ADDIS_ABABA_OFFSET_HOURS = 3;

/**
 * Addis Ababa rush hours, as [from, to) hours of the local day: the morning commute and the
 * evening commute, when traffic slows motorbikes on the main roads.
 */
export const PEAK_HOURS: readonly (readonly [number, number])[] = [
  [7, 10],
  [16, 20],
];

export type TimeBand = 'peak' | 'off_peak';

export function timeBand(at: Date): TimeBand {
  const hour = (at.getUTCHours() + ADDIS_ABABA_OFFSET_HOURS) % 24;
  return PEAK_HOURS.some(([from, to]) => hour >= from && hour < to) ? 'peak' : 'off_peak';
}

export function clipRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

export function recencyWeight(observedAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - observedAt.getTime()) / DAY_MS);
  return 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

/** A made-up leg for the demo and the backtest. It is stored as synthetic. */
export interface SyntheticLeg {
  zone: string;
  startedAt: Date;
  routingSeconds: number;
  actualSeconds: number;
}

/** One trip's ratio, such as actual minutes ÷ routing minutes, and when it happened. */
export interface Observation {
  ratio: number;
  at: Date;
}

/**
 * The weighted geometric mean of the clipped ratios, pulled toward the parent's factor as if the
 * parent added `SHRINKAGE_TRIPS` trips of its own:
 * `exp((Σ wᵢ·ln rᵢ + k·ln f_parent) ÷ (Σ wᵢ + k))`.
 */
export function shrunkFactor(observations: Observation[], parentFactor: number, now: Date): number {
  let weights = 0;
  let weightedLogs = 0;
  for (const { ratio, at } of observations) {
    const weight = recencyWeight(at, now);
    weights += weight;
    weightedLogs += weight * Math.log(clipRatio(ratio));
  }
  const prior = SHRINKAGE_TRIPS * Math.log(parentFactor);
  return Math.exp((weightedLogs + prior) / (weights + SHRINKAGE_TRIPS));
}

/** An observation with the zones it belongs to, from the broadest, such as the city, inward. */
export interface ZonedObservation extends Observation {
  zones: readonly string[];
}

export interface LearnedFactor {
  zone: string;
  factor: number;
  trips: number;
}

/**
 * Learns a factor for every zone that has trips. The broadest zone shrinks toward 1, the formula
 * itself, and each smaller zone shrinks toward the zone around it.
 */
export function learnFactors(observations: ZonedObservation[], now: Date): LearnedFactor[] {
  const learned = new Map<string, LearnedFactor>();
  const depth = Math.max(0, ...observations.map((o) => o.zones.length));
  for (let level = 0; level < depth; level += 1) {
    for (const [zone, inZone] of groupByZone(observations, level)) {
      const parent = level === 0 ? undefined : inZone[0]?.zones[level - 1];
      const parentFactor = parent === undefined ? 1 : (learned.get(parent)?.factor ?? 1);
      learned.set(zone, {
        zone,
        factor: shrunkFactor(inZone, parentFactor, now),
        trips: inZone.length,
      });
    }
  }
  return [...learned.values()];
}

function groupByZone(
  observations: ZonedObservation[],
  level: number,
): Map<string, ZonedObservation[]> {
  const groups = new Map<string, ZonedObservation[]>();
  for (const observation of observations) {
    const zone = observation.zones[level];
    if (zone === undefined) continue;
    groups.set(zone, [...(groups.get(zone) ?? []), observation]);
  }
  return groups;
}

export interface FactorLookup {
  factor: number;
  trips: number;
  /** The zone whose factor this is, or null when no zone has trips and the formula stands. */
  from: string | null;
}

/** The factor of the first zone in `zones`, from the smallest outward, that has one. */
export function lookupFactor(
  zones: readonly string[],
  learned: ReadonlyMap<string, { factor: number; trips: number }>,
): FactorLookup {
  for (const zone of zones) {
    const found = learned.get(zone);
    if (found) return { factor: found.factor, trips: found.trips, from: zone };
  }
  return { factor: 1, trips: 0, from: null };
}

/** How far estimates were from what happened, as a share of what happened. */
export function meanAbsoluteError(pairs: { estimate: number; actual: number }[]): number {
  if (pairs.length === 0) return 0;
  const total = pairs.reduce((sum, p) => sum + Math.abs(p.estimate - p.actual) / p.actual, 0);
  return total / pairs.length;
}
