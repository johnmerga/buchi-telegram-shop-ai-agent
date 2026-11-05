import { Money, type DeliverySettings, type DeliveryType } from '@buchi/shared';
import type { Route } from './distance.domain';

/** Which of the design doc's four ranges the road distance falls in. */
export type DeliveryArea = 'free' | 'standard' | 'far' | 'beyond';

/** Far-area prices come from drivers (Task 5.6), so the formula prices only these options. */
export type PricedDeliveryType = Exclude<DeliveryType, 'far'>;

export interface DeliveryOption {
  type: PricedDeliveryType;
  /** What the customer pays. */
  fee: Money;
  /** What the formula pays the driver. The shop covers the gap to the fee. */
  payout: Money;
}

export interface DeliveryQuote {
  area: DeliveryArea;
  route: Route;
  /** Pickup is always the last option. */
  options: DeliveryOption[];
}

/** Customers see delivery fees in whole tens of birr. */
const FEE_STEP = Money.of('10');

const pickup: DeliveryOption = { type: 'pickup', fee: Money.zero, payout: Money.zero };

/** Each range includes its outer edge: exactly 3 km is inside a 3 km free radius. */
export function deliveryArea(meters: number, settings: DeliverySettings): DeliveryArea {
  if (meters <= kilometresInMeters(settings.freeRadiusKm)) return 'free';
  if (meters <= kilometresInMeters(settings.standardRangeKm)) return 'standard';
  if (meters <= kilometresInMeters(settings.farRangeKm)) return 'far';
  return 'beyond';
}

/**
 * base fee + rate per km × road km + rate per minute × expected minutes, where the expected minutes
 * are the routing minutes times the zone's time factor. Each part rounds up to the next cent.
 */
export function driverPayout(route: Route, timeFactor: number, settings: DeliverySettings): Money {
  const expectedSeconds = Math.round(route.seconds * timeFactor);
  return Money.of(settings.baseFee)
    .add(Money.of(settings.ratePerKm).times(route.meters).divideRoundingUp(1000))
    .add(Money.of(settings.ratePerMinute).times(expectedSeconds).divideRoundingUp(60));
}

export function expressFee(payout: Money): Money {
  return payout.roundUpTo(FEE_STEP);
}

/**
 * Express × (1 − discount), rounded down to whole tens of birr. Rounding the discount up instead of
 * the price keeps Saver a round number and never cheaper for the customer than the owner promised.
 */
export function saverFee(express: Money, discountPercent: number): Money {
  const discount = express.times(discountPercent).divideRoundingUp(100).roundUpTo(FEE_STEP);
  return express.subtract(discount);
}

/** The options a customer can choose from for a trip from the shop. */
export function quoteDelivery(
  route: Route,
  timeFactor: number,
  settings: DeliverySettings,
): DeliveryQuote {
  const area = deliveryArea(route.meters, settings);
  const payout = driverPayout(route, timeFactor, settings);
  const express = expressFee(payout);
  const options: Record<DeliveryArea, DeliveryOption[]> = {
    free: [{ type: 'free', fee: Money.zero, payout }, pickup],
    standard: [
      { type: 'express', fee: express, payout },
      // A Saver run's real payout is per run (Task 5.4). The trip's formula payout estimates it.
      { type: 'saver', fee: saverFee(express, settings.saverDiscountPercent), payout },
      pickup,
    ],
    far: [pickup],
    beyond: [pickup],
  };
  return { area, route, options: options[area] };
}

function kilometresInMeters(kilometres: number): number {
  return Math.round(kilometres * 1000);
}
