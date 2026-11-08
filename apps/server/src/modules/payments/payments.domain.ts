import type { Money, PaymentAccount } from '@buchi/shared';
import { firstNameMatches, receiverMatches } from '../../shared/accounts';
import type { ReadReceipt } from './receipt-reading.domain';

/** R5's tolerance: phone clocks and receipt times can be a few minutes off. */
const TIME_TOLERANCE_MS = 5 * 60 * 1000;

export type Check = 'pass' | 'fail';
export type AmountCheck = 'exact' | 'underpaid' | 'overpaid';

/** R3: the receipt pays exactly what is still due on the order. */
export function checkAmount(paid: Money, due: Money): AmountCheck {
  const comparison = paid.compare(due);
  if (comparison === 0) return 'exact';
  return comparison < 0 ? 'underpaid' : 'overpaid';
}

/**
 * What is still due: the order total minus earlier partial payments. A partial payment counts
 * once, so resending its screenshot asks for the same difference again.
 */
export function amountDue(
  total: Money,
  partialPayments: { txRef: string; amount: Money }[],
  txRef: string,
): Money {
  const counted = new Map(
    partialPayments.filter((p) => p.txRef !== txRef).map((p) => [p.txRef, p.amount]),
  );
  return [...counted.values()].reduce((due, paid) => due.subtract(paid), total);
}

/** R4: the receiver is one of the shop's accounts with the receipt's provider. */
export function matchingAccount(
  receipt: ReadReceipt,
  accounts: PaymentAccount[],
): PaymentAccount | undefined {
  return accounts.find(
    (account) =>
      account.provider === receipt.provider &&
      (receipt.receiverFirstNameOnly
        ? firstNameMatches(receipt.receiver.name, account)
        : receiverMatches(receipt.receiver, account)),
  );
}

/** R5: the payment happened after the order was placed, so the receipt is not an older one. */
export function checkTime(paidAt: Date, orderCreatedAt: Date): Check {
  return paidAt.getTime() >= orderCreatedAt.getTime() - TIME_TOLERANCE_MS ? 'pass' : 'fail';
}

/** R6: the reference belongs to this order. A resend for the same order is not reuse. */
export function checkReference(claimedByOrderId: string, orderId: string): Check {
  return claimedByOrderId === orderId ? 'pass' : 'fail';
}

/**
 * The key rule R6 compares references by. Screenshot readers confuse O with 0 and I with 1, and
 * references print in capitals, so the key folds those letters to digits.
 */
export function referenceKey(txRef: string): string {
  return txRef.toUpperCase().replaceAll('O', '0').replaceAll('I', '1');
}
