import { Money } from '@buchi/shared';

/** The owner's private range for a negotiable product. Only code sees it. */
export interface PriceLimits {
  asking: Money;
  lowest: Money;
}

/** What the agent already offered in this conversation. */
export interface NegotiationState {
  lastOffer: Money | null;
  concessionsMade: number;
}

export type PriceDecision =
  | { result: 'accepted'; reason: 'within_limits' | 'concession'; value: Money }
  | {
      result: 'rejected';
      reason: 'above_asking' | 'too_low' | 'no_concessions_left';
      counteroffer: Money;
    };

const MAX_CONCESSIONS = 2;
const PRICE_STEP = Money.of('50');

/**
 * Checks a price the sales agent wants to offer. An accepted price is always within
 * [lowest, asking]. A rejection carries a counteroffer that this checker would accept if the agent
 * proposed it next, so the agent never loops on prices that cannot pass.
 */
export function checkNegotiatedPrice(
  proposed: Money,
  limits: PriceLimits,
  state: NegotiationState,
): PriceDecision {
  if (limits.lowest.compare(limits.asking) > 0) {
    throw new RangeError('The lowest price is above the asking price');
  }
  if (proposed.compare(limits.asking) > 0) {
    return { result: 'rejected', reason: 'above_asking', counteroffer: limits.asking };
  }

  const standing = standingOffer(limits, state.lastOffer);
  const concession = proposed.compare(standing) < 0;
  if (concession && state.concessionsMade >= MAX_CONCESSIONS) {
    return { result: 'rejected', reason: 'no_concessions_left', counteroffer: standing };
  }
  if (proposed.compare(limits.lowest) < 0) {
    return {
      result: 'rejected',
      reason: 'too_low',
      counteroffer: min(standing, floorOffer(limits)),
    };
  }
  return {
    result: 'accepted',
    reason: concession ? 'concession' : 'within_limits',
    value: proposed,
  };
}

/** The price the agent stands on now: its last offer while that is still within the limits. */
function standingOffer(limits: PriceLimits, lastOffer: Money | null): Money {
  const withinLimits =
    lastOffer !== null &&
    lastOffer.compare(limits.lowest) >= 0 &&
    lastOffer.compare(limits.asking) <= 0;
  return withinLimits ? lastOffer : limits.asking;
}

/**
 * The counteroffer to a price below the lowest: a quarter of the way from the lowest price to the
 * asking price, rounded up to the next 50 birr, and never above the asking price. It stays strictly
 * above the lowest price whenever the asking price is, so the agent never learns the lowest price,
 * and the 50-birr rounding hides its exact digits. The quarter keeps most of the range for the
 * owner while giving the agent a real concession to offer.
 */
function floorOffer({ asking, lowest }: PriceLimits): Money {
  const quarterOfRange = asking.subtract(lowest).divideRoundingUp(4);
  return min(asking, lowest.add(quarterOfRange).roundUpTo(PRICE_STEP));
}

function min(a: Money, b: Money): Money {
  return a.compare(b) <= 0 ? a : b;
}
