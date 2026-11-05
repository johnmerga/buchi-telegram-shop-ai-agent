import { Money, type BankCheck } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { decide, type CheckedRules, type DecisionInput } from './payments.decision.domain';

const allPass: CheckedRules = {
  r1: 'pass',
  r2: 'pass',
  r3: 'exact',
  r4: 'pass',
  r5: 'pass',
  r6: 'pass',
};
const banks: BankCheck[] = ['CONFIRMED', 'NOT_FOUND', 'MISMATCH', 'UNAVAILABLE'];

function checked(overrides: Partial<Extract<DecisionInput, { stage: 'checked' }>> = {}) {
  return decide({
    stage: 'checked',
    rules: allPass,
    bank: 'CONFIRMED',
    paid: Money.of('900'),
    due: Money.of('900'),
    payerHighRisk: false,
    ...overrides,
  });
}

describe('the decision matrix', () => {
  it('approves when all rules pass and the bank page confirms', () => {
    expect(checked()).toEqual({ outcome: 'approve', bankVerified: true });
  });

  it('approves up to 1,000 birr without the bank page, marked not bank-verified', () => {
    const limit = { paid: Money.of('1000'), due: Money.of('1000'), bank: 'UNAVAILABLE' as const };
    expect(checked(limit)).toEqual({ outcome: 'approve', bankVerified: false });
  });

  it('sends a payment above the limit to the owner when the bank page is unavailable', () => {
    const above = {
      paid: Money.of('1000.01'),
      due: Money.of('1000.01'),
      bank: 'UNAVAILABLE' as const,
    };
    expect(checked(above)).toEqual({ outcome: 'review', reason: 'over_limit' });
  });

  it('sends a high-risk payer to the owner when the bank page is unavailable', () => {
    expect(checked({ bank: 'UNAVAILABLE', payerHighRisk: true })).toEqual({
      outcome: 'review',
      reason: 'high_risk',
    });
  });

  it('approves a high-risk payer whom the bank page confirms', () => {
    expect(checked({ payerHighRisk: true })).toEqual({ outcome: 'approve', bankVerified: true });
  });

  it('sends a transaction that the bank page does not know to the owner', () => {
    expect(checked({ bank: 'NOT_FOUND' })).toEqual({ outcome: 'review', reason: 'bank_not_found' });
  });

  it.each(['r4', 'r5', 'r6'] as const)('rejects when %s fails, whatever the bank says', (rule) => {
    const reason = { r4: 'receiver', r5: 'time', r6: 'reused' }[rule];
    for (const bank of banks) {
      const decision = checked({ rules: { ...allPass, [rule]: 'fail' }, bank });
      expect(decision).toMatchObject({ outcome: 'reject' });
      expect(decision).toHaveProperty('reasons', expect.arrayContaining([reason]));
    }
  });

  it('rejects when the bank page differs from the screenshot, whatever the rules say', () => {
    for (const r3 of ['exact', 'underpaid', 'overpaid'] as const) {
      expect(
        checked({ rules: { ...allPass, r3 }, bank: 'MISMATCH', due: Money.of('1000') }),
      ).toEqual({
        outcome: 'reject',
        reasons: ['bank_mismatch'],
      });
    }
  });

  it('asks for the difference of a bank-confirmed underpayment', () => {
    const decision = checked({ rules: { ...allPass, r3: 'underpaid' }, due: Money.of('1500') });
    expect(decision).toEqual({ outcome: 'ask_difference', missing: Money.of('600') });
  });

  it('sends an underpayment without bank confirmation to the owner', () => {
    for (const bank of ['NOT_FOUND', 'UNAVAILABLE'] as const) {
      expect(checked({ rules: { ...allPass, r3: 'underpaid' }, bank })).toEqual({
        outcome: 'review',
        reason: 'underpaid_unconfirmed',
      });
    }
  });

  it('sends an overpayment to the owner', () => {
    expect(checked({ rules: { ...allPass, r3: 'overpaid' } })).toEqual({
      outcome: 'review',
      reason: 'overpaid',
    });
  });

  it('asks for a clearer screenshot first, then sends an unreadable one to the owner', () => {
    expect(decide({ stage: 'unreadable', earlierUnreadable: 0 })).toEqual({
      outcome: 'ask_clearer',
    });
    expect(decide({ stage: 'unreadable', earlierUnreadable: 1 })).toEqual({
      outcome: 'review',
      reason: 'unreadable',
    });
  });

  it('sends an unsupported provider to the owner', () => {
    expect(decide({ stage: 'unsupported_provider' })).toEqual({
      outcome: 'review',
      reason: 'unsupported_provider',
    });
  });
});
