import { describe, expect, it } from 'vitest';
import { settledOutcome } from './payment-history.domain';

describe('settledOutcome', () => {
  it("names Buchi's own decision", () => {
    expect(settledOutcome({ decision: 'approve', ownerDecision: null })).toEqual({
      outcome: 'approved',
      decidedBy: 'buchi',
    });
    expect(settledOutcome({ decision: 'ask_full_amount', ownerDecision: null })).toEqual({
      outcome: 'asked_full_amount',
      decidedBy: 'buchi',
    });
  });

  it("lets the owner's answer override Buchi's", () => {
    expect(settledOutcome({ decision: 'review', ownerDecision: 'approved' })).toEqual({
      outcome: 'approved',
      decidedBy: 'owner',
    });
    expect(settledOutcome({ decision: 'reject', ownerDecision: 'approved' })).toEqual({
      outcome: 'approved',
      decidedBy: 'owner',
    });
  });

  it('has no outcome while the owner has not answered a review', () => {
    expect(settledOutcome({ decision: 'review', ownerDecision: null })).toBeUndefined();
  });
});
