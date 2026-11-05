import type { Money } from '@buchi/shared';

export interface DeliveryPriceLimits {
  /** What the delivery formula pays a driver for this trip. Drivers never get less. */
  formulaPayout: Money;
  /** The most the owner lets an agent offer without asking. */
  cap: Money;
}

export type DeliveryPriceDecision =
  | { result: 'accepted'; reason: 'within_limits'; value: Money }
  | { result: 'rejected'; reason: 'below_formula_payout'; counteroffer: Money }
  | { result: 'needs_owner'; reason: 'above_cap' };

/** Checks a far-area delivery price. Nothing above the owner's cap proceeds without the owner. */
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
  return { result: 'accepted', reason: 'within_limits', value: proposed };
}
