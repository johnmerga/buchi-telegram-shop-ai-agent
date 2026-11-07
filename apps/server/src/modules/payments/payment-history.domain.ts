import type { PaymentOutcome } from '@buchi/shared';
import type { Decision } from './payments.decision.domain';

/** A stored proof's decisions: Buchi's own, and the owner's answer to a review or a report. */
interface ProofDecisions {
  decision: Decision['outcome'];
  ownerDecision: 'approved' | 'rejected' | null;
}

type BuchiDecision = Exclude<Decision['outcome'], 'review'>;

const buchiOutcomes: Record<BuchiDecision, PaymentOutcome> = {
  approve: 'approved',
  reject: 'rejected',
  ask_difference: 'asked_rest',
  ask_full_amount: 'asked_full_amount',
  ask_clearer: 'asked_clearer',
  ask_reference: 'asked_reference',
};

/**
 * Who settled a proof and how. The owner's answer overrides Buchi's, as it does for the order. A
 * proof still waiting for the owner has no outcome yet.
 */
export function settledOutcome(
  proof: ProofDecisions,
): { outcome: PaymentOutcome; decidedBy: 'buchi' | 'owner' } | undefined {
  if (proof.ownerDecision !== null) {
    return { outcome: proof.ownerDecision, decidedBy: 'owner' };
  }
  if (proof.decision === 'review') return undefined;
  return { outcome: buchiOutcomes[proof.decision], decidedBy: 'buchi' };
}
