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
      reason: 'above_asking' | 'above_last_offer' | 'too_low' | 'no_concessions_left';
      counteroffer: Money;
    };

const MAX_CONCESSIONS = 2;

/**
 * The step a counteroffer is rounded up to, sized to the owner's range so that rounding never eats
 * the concession: 50 birr on a range of hundreds, down to 1 birr on a range of a few birr. With a
 * fixed 50, a 140-birr product whose lowest price was 100 could only ever be countered at 140.
 */
function priceStep(range: Money): Money {
  const steps = [
    { atLeast: '200', step: '50' },
    { atLeast: '40', step: '10' },
    { atLeast: '20', step: '5' },
  ];
  const fit = steps.find(({ atLeast }) => range.compare(Money.of(atLeast)) >= 0);
  return Money.of(fit?.step ?? '1');
}

/**
 * Checks a price the sales agent wants to offer. An accepted price is always within
 * [lowest, asking], and never above the agent's last offer, because a customer who was offered a
 * price must not see it rise. A rejection carries a counteroffer that this checker would accept if
 * the agent proposed it next, so the agent never loops on prices that cannot pass.
 */
export function checkNegotiatedPrice(
  proposed: Money,
  limits: PriceLimits,
  state: NegotiationState,
): PriceDecision {
  if (limits.lowest.compare(limits.asking) > 0) {
    throw new RangeError('The lowest price is above the asking price');
  }
  // A last offer the owner's current prices no longer allow belongs to an old negotiation, so its
  // concessions do not count either: the talk starts over from the new asking price.
  const lastOfferStands = withinLimits(limits, state.lastOffer);
  const standing = lastOfferStands && state.lastOffer ? state.lastOffer : limits.asking;
  const concessionsMade = lastOfferStands ? state.concessionsMade : 0;
  if (proposed.compare(limits.asking) > 0) {
    return { result: 'rejected', reason: 'above_asking', counteroffer: standing };
  }
  if (proposed.compare(standing) > 0) {
    return { result: 'rejected', reason: 'above_last_offer', counteroffer: standing };
  }
  const concession = proposed.compare(standing) < 0;
  if (concession && concessionsMade >= MAX_CONCESSIONS) {
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

/** Whether the agent's last offer is still within the owner's current limits. */
function withinLimits(limits: PriceLimits, lastOffer: Money | null): boolean {
  return (
    lastOffer !== null &&
    lastOffer.compare(limits.lowest) >= 0 &&
    lastOffer.compare(limits.asking) <= 0
  );
}

/**
 * The counteroffer to a price below the lowest: a quarter of the way from the lowest price to the
 * asking price, rounded up to a step that suits the range, and never above the asking price. It
 * stays strictly above the lowest price whenever the asking price is, so the agent never learns the
 * lowest price, and the rounding hides its exact digits. The quarter keeps most of the range for
 * the owner while giving the agent a real concession to offer.
 */
function floorOffer({ asking, lowest }: PriceLimits): Money {
  const range = asking.subtract(lowest);
  const quarterOfRange = range.divideRoundingUp(4);
  return min(asking, lowest.add(quarterOfRange).roundUpTo(priceStep(range)));
}

function min(a: Money, b: Money): Money {
  return a.compare(b) <= 0 ? a : b;
}
