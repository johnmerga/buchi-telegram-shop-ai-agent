import { Money, type BankCheck } from '@buchi/shared';
import type { AmountCheck, Check } from './payments.domain';
import type { ImplausibleReason } from './receipt-reading.domain';

/** The design doc's default: without a bank check, Buchi approves on its own only up to this. */
const AUTO_APPROVE_LIMIT = Money.of('1000.00');

/** Rule results once R1 and R2 have passed and R3 to R6 could run. */
export type CheckedRules = {
  r1: 'pass';
  r2: 'pass';
  r3: AmountCheck;
  r4: Check;
  r5: Check;
  r6: Check;
};

/** The rule results stored with a proof. A rule that could not run is left out. */
export type RuleResults = { r1: 'fail' } | { r1: 'pass'; r2: 'fail' } | CheckedRules;

export type DecisionInput =
  | { stage: 'unreadable'; earlierUnreadable: number }
  | { stage: 'unknown_layout' }
  | { stage: 'implausible'; reason: ImplausibleReason }
  | {
      stage: 'checked';
      rules: CheckedRules;
      bank: BankCheck;
      paid: Money;
      due: Money;
      payerHighRisk: boolean;
      /** R4 saw only the receiver's first name, so only the bank's page can confirm the receiver. */
      receiverFirstNameOnly: boolean;
    };

export type RejectReason = 'receiver' | 'time' | 'reused' | 'bank_mismatch';

export type ReviewReason =
  | ImplausibleReason
  | 'extraction_failed'
  | 'unreadable'
  | 'unknown_layout'
  | 'receiver_unconfirmed'
  | 'overpaid'
  | 'underpaid_unconfirmed'
  | 'bank_not_found'
  | 'over_limit'
  | 'high_risk';

export type Decision =
  | { outcome: 'approve'; bankVerified: boolean }
  | { outcome: 'reject'; reasons: RejectReason[] }
  | { outcome: 'review'; reason: ReviewReason }
  | { outcome: 'ask_difference'; missing: Money }
  | { outcome: 'ask_clearer' };

const review = (reason: ReviewReason): Decision => ({ outcome: 'review', reason });

/** The design doc's decision matrix. Anything it does not approve or reject goes to the owner. */
export function decide(input: DecisionInput): Decision {
  switch (input.stage) {
    case 'unreadable':
      return input.earlierUnreadable > 0 ? review('unreadable') : { outcome: 'ask_clearer' };
    case 'unknown_layout':
      return review('unknown_layout');
    case 'implausible':
      return review(input.reason);
    case 'checked':
      return decideChecked(input);
  }
}

function decideChecked(input: Extract<DecisionInput, { stage: 'checked' }>): Decision {
  const { rules, bank, paid, due, payerHighRisk, receiverFirstNameOnly } = input;
  const rejected: RejectReason[] = [];
  if (rules.r4 === 'fail') rejected.push('receiver');
  if (rules.r5 === 'fail') rejected.push('time');
  if (rules.r6 === 'fail') rejected.push('reused');
  if (bank === 'MISMATCH') return { outcome: 'reject', reasons: [...rejected, 'bank_mismatch'] };
  if (rejected.length > 0) return { outcome: 'reject', reasons: rejected };

  if (rules.r3 === 'overpaid') return review('overpaid');
  if (rules.r3 === 'underpaid') {
    // Asking for the rest accepts the partial payment, so only a bank-confirmed one counts.
    return bank === 'CONFIRMED'
      ? { outcome: 'ask_difference', missing: due.subtract(paid) }
      : review('underpaid_unconfirmed');
  }

  switch (bank) {
    case 'CONFIRMED':
      return { outcome: 'approve', bankVerified: true };
    case 'NOT_FOUND':
      return review('bank_not_found');
    case 'UNAVAILABLE':
      if (receiverFirstNameOnly) return review('receiver_unconfirmed');
      if (payerHighRisk) return review('high_risk');
      return paid.compare(AUTO_APPROVE_LIMIT) <= 0
        ? { outcome: 'approve', bankVerified: false }
        : review('over_limit');
  }
}
