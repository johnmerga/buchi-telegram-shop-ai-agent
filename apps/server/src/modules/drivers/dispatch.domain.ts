import { Money } from '@buchi/shared';
import type { Coordinates } from '../delivery/location.domain';

/** The design doc's rule: owners hear about an Express job that no driver takes in 10 minutes. */
export const ACCEPT_WINDOW_MS = 10 * 60_000;

/** A customer who does not answer within two hours counts as having received the order. */
export const RECEIPT_WINDOW_MS = 2 * 60 * 60_000;

/** Farther than this from the customer's pin, a delivery needs the owner's review. */
export const DELIVERY_RADIUS_M = 300;

const BONUS_PERCENT = 20;
const MIN_BONUS = Money.of('20');
const BONUS_STEP = Money.of('10');

/**
 * A bonus large enough to change a driver's mind: a fifth of the payout, rounded up to whole tens
 * of birr, and at least 20 birr.
 */
export function suggestedBonus(payout: Money): Money {
  const share = payout.times(BONUS_PERCENT).divideRoundingUp(100).roundUpTo(BONUS_STEP);
  return share.compare(MIN_BONUS) < 0 ? MIN_BONUS : share;
}

export function needsReview(metersFromPin: number): boolean {
  return metersFromPin > DELIVERY_RADIUS_M;
}

/** Whole minutes from `from` to `to`, rounded to the nearest minute. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

/** Opens the pin in Google Maps, which drivers already use for directions. */
export function mapsLink(point: Coordinates): string {
  return `https://www.google.com/maps?q=${String(point.latitude)},${String(point.longitude)}`;
}

/** A pin from two nullable columns, which are either both set or both empty. */
export function point(latitude: number | null, longitude: number | null): Coordinates | null {
  return latitude === null || longitude === null ? null : { latitude, longitude };
}
