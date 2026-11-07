import { Money, type MoneyString } from '@buchi/shared';
import { straightLineMeters } from '../delivery/distance.domain';
import type { TimeBand } from '../delivery/factors.domain';
import { parentZone, zoneCenter } from '../delivery/zones.domain';

/** The zone that holds every far trip of one shop. */
const SHOP_ZONE = 'shop';

/**
 * Where an acceptance factor is learned and looked up: the trip's larger zone, then the shop as a
 * whole. Far trips are rarer than deliveries, so the smallest zones would rarely have any.
 */
export function acceptanceFactorZones(zone: string): string[] {
  return [parentZone(zone), SHOP_ZONE];
}

/** Drivers and customers see far-area prices in whole tens of birr. */
const PRICE_STEP = Money.of('10');
/** The design doc's rule: a price nobody accepts rises by 10%. */
const RAISE_PERCENT = 10;

/** `amount × factor`, with the factor to three decimals, rounded up to the next cent. */
export function scaled(amount: Money, factor: number): Money {
  return amount.times(Math.round(factor * 1000)).divideRoundingUp(1000);
}

/**
 * The estimate when the model is unavailable: the formula payout times the zone's acceptance
 * factor, in whole tens of birr, and never below the payout.
 */
export function statisticalPrice(formulaPayout: Money, acceptanceFactor: number): Money {
  const estimate = scaled(formulaPayout, acceptanceFactor).roundUpTo(PRICE_STEP);
  return estimate.compare(formulaPayout) < 0 ? formulaPayout : estimate;
}

/**
 * The next price for an offer nobody accepted: 10% more in whole tens of birr, but never above
 * the cap. Nothing once the price is at the cap or above it, as an owner-approved price is.
 */
export function raisedPrice(current: Money, cap: Money): Money | undefined {
  if (current.compare(cap) >= 0) return undefined;
  const raised = current
    .times(100 + RAISE_PERCENT)
    .divideRoundingUp(100)
    .roundUpTo(PRICE_STEP);
  return raised.compare(cap) > 0 ? cap : raised;
}

/** The design doc's rule: nothing above the owner's cap reaches a driver without the owner. */
export function assertOfferable(price: Money, cap: Money, ownerApproved: boolean): void {
  if (price.compare(cap) > 0 && !ownerApproved) {
    throw new Error('A far-area price above the cap needs the owner to approve it');
  }
}

/** A far trip that a driver held, as evidence for the next estimate. */
export interface PastTrip {
  id: string;
  zone: string;
  routeMeters: number;
  formulaPayout: Money;
  heldPrice: Money;
  raises: number;
  at: Date;
  synthetic: boolean;
}

/**
 * How many times its own formula payout a driver accepted on a past trip, or null when that
 * formula paid nothing. Settings change, so this multiple outlives the trip's price in birr.
 */
export function acceptedMultiple(trip: { formulaPayout: Money; heldPrice: Money }): number | null {
  const formula = Number(trip.formulaPayout.toString());
  return formula > 0 ? Number(trip.heldPrice.toString()) / formula : null;
}

/**
 * The past trips most like this one: the closest destinations with the most similar road
 * distance, newest first on a tie. Both differences are in meters, so they add up directly.
 */
export function similarTrips(
  target: { zone: string; routeMeters: number },
  past: PastTrip[],
  limit: number,
): PastTrip[] {
  const center = zoneCenter(target.zone);
  const scored = past.map((trip) => ({
    trip,
    score:
      straightLineMeters(center, zoneCenter(trip.zone)) +
      Math.abs(trip.routeMeters - target.routeMeters),
  }));
  scored.sort((a, b) => a.score - b.score || b.trip.at.getTime() - a.trip.at.getTime());
  return scored.slice(0, limit).map(({ trip }) => trip);
}

/** What a learned factor rests on: the destination's own zone, a larger area, or nothing yet. */
export type FactorBasis = 'zone' | 'area' | 'city' | 'shop' | 'none';

interface LearnedFactorEvidence {
  value: number;
  trips: number;
  basis: FactorBasis;
}

/** Everything code knows about a far trip's price, for the agent and the statistical estimate. */
export interface FarPriceEvidence {
  routeMeters: number;
  routingMinutes: number;
  /** True when the distance comes from the straight line, without a road route. */
  approximate: boolean;
  formulaPayout: Money;
  timeFactor: LearnedFactorEvidence & { band: TimeBand };
  acceptanceFactor: LearnedFactorEvidence;
  similarTrips: (PastTrip & { daysAgo: number })[];
  areaNotes: { id: string; note: string; daysAgo: number }[];
}

/** A made-up far trip for the demo and the backtest. It is stored as synthetic. */
export interface SyntheticFarTrip {
  id: string;
  zone: string;
  routeMeters: number;
  routingSeconds: number;
  formulaPayout: MoneyString;
  cap: MoneyString;
  firstPrice: MoneyString;
  heldPrice: MoneyString;
  raises: number;
  at: Date;
}
