import { Money, type PaymentAccount, type PaymentProvider } from '@buchi/shared';
import { receiverMatches, type PrintedReceiver } from '../../shared/accounts';
import type { ReceiptExtraction } from './payments.schemas';

/** The design doc's threshold for R1. Below it, Buchi asks for a clearer screenshot. */
const MIN_CONFIDENCE = 0.7;
/** R5's tolerance: phone clocks and receipt times can be a few minutes off. */
const TIME_TOLERANCE_MS = 5 * 60 * 1000;
/** Receipts print local time. Ethiopia has no daylight saving time, so the offset is fixed. */
const ADDIS_ABABA_OFFSET = '+03:00';

export type Check = 'pass' | 'fail';
export type AmountCheck = 'exact' | 'underpaid' | 'overpaid';

type ExtractedProvider = NonNullable<ReceiptExtraction['provider']['value']>;

/** A receipt that passed R1: every field the later rules need was read with enough confidence. */
export interface ReadReceipt {
  provider: ExtractedProvider;
  txRef: string;
  amount: Money;
  receiver: PrintedReceiver;
  paidAt: Date;
}

/** A receipt that also passed R2. */
export interface SupportedReceipt extends ReadReceipt {
  provider: PaymentProvider;
}

/**
 * R1: the image is a readable payment receipt. Classification confidence is `null` when the
 * classifier was unavailable, and then the fields alone decide.
 */
export function readReceipt(
  extraction: ReceiptExtraction,
  classificationConfidence: number | null,
): ReadReceipt | undefined {
  if (classificationConfidence !== null && classificationConfidence < MIN_CONFIDENCE) return;
  const provider = confident(extraction.provider);
  const txRef = confident(extraction.transactionRef);
  const amount = confident(extraction.amount);
  const paidAt = confident(extraction.paidAt);
  const receiver = {
    name: confident(extraction.receiverName) ?? null,
    account: confident(extraction.receiverAccount) ?? null,
  };
  if (!provider || !txRef || !amount || !paidAt) return;
  if (receiver.name === null && receiver.account === null) return;
  const time = new Date(`${paidAt}${ADDIS_ABABA_OFFSET}`);
  if (Number.isNaN(time.getTime())) return;
  return { provider, txRef: txRef.toUpperCase(), amount: Money.of(amount), receiver, paidAt: time };
}

function confident<T>(field: { value: T | null; confidence: number }): T | undefined {
  return field.value !== null && field.confidence >= MIN_CONFIDENCE ? field.value : undefined;
}

/** R2: the provider is one that shops accept payments with. */
export function isSupported(receipt: ReadReceipt): receipt is SupportedReceipt {
  return receipt.provider !== 'other';
}

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
  receipt: SupportedReceipt,
  accounts: PaymentAccount[],
): PaymentAccount | undefined {
  return accounts.find(
    (account) =>
      account.provider === receipt.provider && receiverMatches(receipt.receiver, account),
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
