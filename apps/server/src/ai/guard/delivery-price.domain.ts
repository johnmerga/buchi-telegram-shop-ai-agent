import type { Money } from '@buchi/shared';

export interface DeliveryPriceLimits {
  /** What the delivery formula pays a driver for this trip. Drivers never get less. */
  formulaPayout: Money;
  /** The most the owner lets an agent offer without asking. */
  cap: Money;
  /** True when the routing service failed and the distance comes from the straight line. */
  approximateRoute: boolean;
}

export type DeliveryPriceDecision =
  | { result: 'accepted'; reason: 'within_limits'; value: Money }
  | { result: 'rejected'; reason: 'below_formula_payout'; counteroffer: Money }
  | { result: 'needs_owner'; reason: 'above_cap' | 'approximate_route' };

/**
 * Checks a far-area delivery price. Nothing above the owner's cap proceeds without the owner, and
 * neither does a price for a distance guessed from the straight line, which may be far off.
 */
export function checkDeliveryPrice(
  proposed: Money,
  limits: DeliveryPriceLimits,
): DeliveryPriceDecision {
  if (proposed.compare(limits.cap) > 0) return { result: 'needs_owner', reason: 'above_cap' };
  if (proposed.compare(limits.formulaPayout) < 0) {
    return {
      result: 'rejected',
      reason: 'below_formula_payout',
      counteroffer: limits.formulaPayout,
    };
  }
  if (limits.approximateRoute) return { result: 'needs_owner', reason: 'approximate_route' };
  return { result: 'accepted', reason: 'within_limits', value: proposed };
}
