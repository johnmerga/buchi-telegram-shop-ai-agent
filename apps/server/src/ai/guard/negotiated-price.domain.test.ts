import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { toToolResult } from './decision';
import {
  checkNegotiatedPrice,
  type NegotiationState,
  type PriceLimits,
} from './negotiated-price.domain';

const limits: PriceLimits = { asking: Money.of('1000'), lowest: Money.of('800') };
const opening: NegotiationState = { lastOffer: null, concessionsMade: 0 };
const birr = (amount: string) => Money.of(amount);

function check(proposed: string, state = opening, range = limits) {
  const decision = checkNegotiatedPrice(birr(proposed), range, state);
  return decision.result === 'accepted'
    ? { ...decision, value: decision.value.toString() }
    : { ...decision, counteroffer: decision.counteroffer.toString() };
}

describe('checkNegotiatedPrice', () => {
  it('accepts the asking price without counting a concession', () => {
    expect(check('1000')).toEqual({
      result: 'accepted',
      reason: 'within_limits',
      value: '1000.00',
    });
  });

  it('accepts a lower price within the range as a concession', () => {
    expect(check('850')).toEqual({ result: 'accepted', reason: 'concession', value: '850.00' });
  });

  it('accepts the lowest price itself', () => {
    expect(check('800')).toMatchObject({ result: 'accepted', value: '800.00' });
  });

  it('accepts repeating the last offer even after two concessions', () => {
    const state = { lastOffer: birr('900'), concessionsMade: 2 };
    expect(check('900', state)).toEqual({
      result: 'accepted',
      reason: 'within_limits',
      value: '900.00',
    });
  });

  it('rejects a price above the asking price with the asking price', () => {
    expect(check('1200')).toEqual({
      result: 'rejected',
      reason: 'above_asking',
      counteroffer: '1000.00',
    });
  });

  it('rejects raising the price above the last offer, with the last offer', () => {
    const state = { lastOffer: birr('900'), concessionsMade: 2 };
    expect(check('950', state)).toEqual({
      result: 'rejected',
      reason: 'above_last_offer',
      counteroffer: '900.00',
    });
  });

  it('counters a price above the asking price with the last offer once one was made', () => {
    const state = { lastOffer: birr('900'), concessionsMade: 1 };
    expect(check('1200', state)).toEqual({
      result: 'rejected',
      reason: 'above_asking',
      counteroffer: '900.00',
    });
  });

  it('rejects a price below the lowest price with a counteroffer above the lowest', () => {
    // 800 + a quarter of 200 = 850, already a multiple of 50.
    expect(check('700')).toEqual({ result: 'rejected', reason: 'too_low', counteroffer: '850.00' });
  });

  it('rounds the counteroffer up to the next 50 birr', () => {
    const range = { asking: birr('1000'), lowest: birr('810') };
    expect(check('500', opening, range)).toMatchObject({ counteroffer: '900.00' });
  });

  it('caps the counteroffer at the asking price', () => {
    const range = { asking: birr('820'), lowest: birr('810') };
    expect(check('500', opening, range)).toMatchObject({ counteroffer: '820.00' });
  });

  it('never counters above the price the agent already offered', () => {
    const state = { lastOffer: birr('820'), concessionsMade: 1 };
    expect(check('700', state)).toMatchObject({ reason: 'too_low', counteroffer: '820.00' });
  });

  it('rejects a third concession and holds the last offer', () => {
    const state = { lastOffer: birr('900'), concessionsMade: 2 };
    expect(check('880', state)).toEqual({
      result: 'rejected',
      reason: 'no_concessions_left',
      counteroffer: '900.00',
    });
  });

  it('ignores a last offer that the current limits no longer allow', () => {
    const state = { lastOffer: birr('700'), concessionsMade: 0 };
    expect(check('1000', state)).toMatchObject({ result: 'accepted', reason: 'within_limits' });
    expect(check('600', state)).toMatchObject({ counteroffer: '850.00' });
  });

  it('refuses limits where the lowest price is above the asking price', () => {
    const range = { asking: birr('800'), lowest: birr('900') };
    expect(() => checkNegotiatedPrice(birr('850'), range, opening)).toThrow(RangeError);
  });
});

/** A small deterministic generator, so a failing case can be reproduced. */
function randomInts(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % below;
  };
}

function fromCents(cents: number): Money {
  return Money.of(
    `${Math.floor(cents / 100).toString()}.${(cents % 100).toString().padStart(2, '0')}`,
  );
}

describe('checkNegotiatedPrice for any input', () => {
  const next = randomInts(42);
  const cases = Array.from({ length: 20_000 }, () => {
    const lowest = next(500_000);
    const asking = lowest + (next(4) === 0 ? next(3) : next(200_000));
    const lastOffer = next(3) === 0 ? null : fromCents(next(asking + 50_000));
    return {
      limits: { asking: fromCents(asking), lowest: fromCents(lowest) },
      state: { lastOffer, concessionsMade: next(4) },
      proposed: fromCents(next(asking + 100_000)),
    };
  });

  it('accepts only prices within the limits', () => {
    for (const { limits: range, state, proposed } of cases) {
      const decision = checkNegotiatedPrice(proposed, range, state);
      if (decision.result !== 'accepted') continue;
      expect(decision.value.compare(range.lowest)).toBeGreaterThanOrEqual(0);
      expect(decision.value.compare(range.asking)).toBeLessThanOrEqual(0);
    }
  });

  it('counteroffers a price that it would accept next', () => {
    for (const { limits: range, state, proposed } of cases) {
      const decision = checkNegotiatedPrice(proposed, range, state);
      if (decision.result !== 'rejected') continue;
      const retry = checkNegotiatedPrice(decision.counteroffer, range, state);
      expect(retry.result).toBe('accepted');
    }
  });

  it('never shows the model the lowest price it did not name or offer itself', () => {
    for (const { limits: range, state, proposed } of cases) {
      const lowest = range.lowest.toString();
      const alreadyKnown = [range.asking, state.lastOffer, proposed].some(
        (known) => known?.toString() === lowest,
      );
      if (alreadyKnown) continue;
      const decision = checkNegotiatedPrice(proposed, range, state);
      const shown = JSON.stringify(toToolResult(decision, (amount) => amount.toString()));
      expect(shown.match(/\d+\.\d\d/g) ?? []).not.toContain(lowest);
    }
  });
});
