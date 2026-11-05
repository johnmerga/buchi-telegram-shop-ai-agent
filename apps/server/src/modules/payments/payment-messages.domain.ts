import { formatBirr, type BankCheck, type MoneyString } from '@buchi/shared';
import { orderReference } from '../orders/orders.domain';
import type { Decision, RejectReason, ReviewReason } from './payments.decision.domain';
import type { ReadReceipt } from './payments.domain';

/** Buchi never accuses a customer: each reason says only what did not match. */
const rejectReasons: Record<RejectReason, string> = {
  receiver: "the receiver is not one of the shop's accounts",
  time: 'the payment was made before this order was placed',
  reused: 'this transaction is already used for another order',
  bank_mismatch: "the details differ from the bank's receipt",
};

const reviewReasons: Record<ReviewReason, string> = {
  extraction_failed: 'Buchi could not read the screenshot.',
  unreadable: 'The screenshot was unclear twice.',
  unsupported_provider: 'The payment provider is not one the shop accepts.',
  overpaid: 'The customer paid more than the total.',
  underpaid_unconfirmed: 'The customer paid less than the total, and the bank did not confirm it.',
  bank_not_found: "The bank's receipt page does not show this transaction.",
  over_limit: "The bank's page was unavailable, and the amount is above the automatic limit.",
  high_risk: "The bank's page was unavailable, and this payer had payment problems before.",
};

const bankResults: Record<BankCheck, string> = {
  CONFIRMED: 'confirmed',
  NOT_FOUND: 'transaction not found',
  MISMATCH: 'details differ',
  UNAVAILABLE: 'page unavailable',
};

/** What the customer reads after Buchi checks their screenshot. */
export function customerMessage(decision: Decision, orderId: string): string {
  const reference = orderReference(orderId);
  switch (decision.outcome) {
    case 'approve':
      return paymentConfirmed(orderId);
    case 'reject':
      return [
        `ይቅርታ / Sorry, we could not confirm the payment for order ${reference}: ${decision.reasons.map((r) => rejectReasons[r]).join('; ')}.`,
        "Please check that you paid the shop's account for this order and send that screenshot here.",
      ].join('\n');
    case 'review':
      return `🔎 እናመሰግናለን / Thank you! The shop is checking your payment for order ${reference} and will confirm it here soon.`;
    case 'ask_difference':
      return `እናመሰግናለን / Thank you! ${formatBirr(decision.missing.toString())} is still missing for order ${reference}. Please pay the rest to the same account and send that screenshot here.`;
    case 'ask_clearer':
      return 'ይቅርታ / Sorry, we could not read the screenshot. Please send a clear screenshot of the whole receipt.';
  }
}

export function paymentConfirmed(orderId: string): string {
  return `✅ ክፍያዎ ተረጋግጧል / Payment received for order ${orderReference(orderId)}. Thank you! Pickup at the shop.`;
}

export function paymentDeclinedByOwner(orderId: string): string {
  return `ይቅርታ / Sorry, the shop could not confirm the payment for order ${orderReference(orderId)}. Please check the payment and send the screenshot again, or contact the shop.`;
}

export const alreadyChecking = (orderId: string) =>
  `🔎 We are already checking the payment for order ${orderReference(orderId)}. We will confirm it here soon.`;

export const noUnpaidOrder =
  'ይቅርታ / Sorry, you have no order waiting for payment. Tap Buy on a channel post to order.';

export const productPhotoReply =
  'ስለ ፎቶው እናመሰግናለን / Thanks for the photo! To order, tap Buy on the product in our channel.';

export const otherImageReply =
  'ስለ ፎቶው እናመሰግናለን / Thanks! To pay for an order, send the screenshot of the payment receipt.';

export function ownerApproved(
  order: { orderId: string; total: MoneyString },
  bankVerified: boolean,
): string {
  return `✅ Paid: order ${orderReference(order.orderId)} · ${formatBirr(order.total)} · ${bankVerified ? 'bank-verified' : 'not bank-verified'}`;
}

export function ownerRejected(orderId: string, reasons: RejectReason[]): string {
  return [
    `⚠️ Payment for order ${orderReference(orderId)} not accepted: ${reasons.map((r) => rejectReasons[r]).join('; ')}.`,
    'Buchi asked the customer to check it.',
  ].join('\n');
}

/** The caption of the screenshot that owners review, with what Buchi read and why it stopped. */
export function reviewCaption(input: {
  orderId: string;
  total: MoneyString;
  reason: ReviewReason;
  receipt: ReadReceipt | undefined;
  bank: BankCheck | null;
}): string {
  const { receipt } = input;
  return [
    `🔎 Check the payment for order ${orderReference(input.orderId)} · total ${formatBirr(input.total)}`,
    reviewReasons[input.reason],
    receipt &&
      `Screenshot: ${formatBirr(receipt.amount.toString())} · ${receipt.provider} · ${receipt.txRef}`,
    input.bank && `Bank page: ${bankResults[input.bank]}`,
  ]
    .filter(Boolean)
    .join('\n');
}
