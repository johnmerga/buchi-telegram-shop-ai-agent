import { formatBirr, type BankCheck, type MoneyString } from '@buchi/shared';
import { orderReference } from '../orders/orders.domain';
import type { Button } from '../owner/owner.domain';
import { reportCallbackData } from './payments.schemas';
import type { Decision, RejectReason, ReviewReason } from './payments.decision.domain';
import type { ReadReceipt } from './receipt-reading.domain';

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
  unknown_layout: 'Buchi does not know this receipt layout.',
  unparseable: 'A field on the receipt is not in the format that its layout prints.',
  reference_date:
    "The transaction reference does not match the receipt's date, so it may be edited.",
  amount_total: "The amount and charges do not add up to the receipt's total, so it may be edited.",
  not_completed: 'The receipt does not show a completed transaction.',
  receiver_unconfirmed:
    "The receipt shows only the receiver's first name, and the bank's page was unavailable.",
  overpaid: 'The customer paid more than the total.',
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
        `ይቅርታ / Sorry, the payment for order ${reference} was not accepted: ${decision.reasons.map((r) => rejectReasons[r]).join('; ')}.`,
        'This order is now closed and the item is back on sale. If you think this is a mistake, tap Report a problem and the shop will check it.',
      ].join('\n');
    case 'review':
      return `🔎 እናመሰግናለን / Thank you! The shop is checking your payment for order ${reference} and will confirm it here soon.`;
    case 'ask_difference':
      return `እናመሰግናለን / Thank you! ${formatBirr(decision.missing.toString())} is still missing for order ${reference}. Please pay the rest to the same account and send that screenshot here.`;
    case 'ask_full_amount':
      return `ይቅርታ / Sorry, this receipt shows ${formatBirr(decision.paid.toString())}, less than the ${formatBirr(decision.due.toString())} due for order ${reference}. Please send the receipt for the full amount here.`;
    case 'ask_clearer':
      return 'ይቅርታ / Sorry, we could not read the screenshot. Please send a clear screenshot of the whole receipt.';
  }
}

export function paymentConfirmed(orderId: string): string {
  return `✅ ክፍያዎ ተረጋግጧል / Payment received for order ${orderReference(orderId)}. Thank you! Pickup at the shop.`;
}

export function paymentDeclinedByOwner(orderId: string): string {
  return `ይቅርታ / Sorry, the shop could not confirm the payment for order ${orderReference(orderId)}, so this order is closed. Please contact the shop if you paid.`;
}

/** The reply to another screenshot for an order whose payment was rejected. */
export function orderClosed(orderId: string): string {
  return `ይቅርታ / Sorry, the payment for order ${orderReference(orderId)} was not accepted, so this order is closed and takes no more screenshots. Tap Buy on a channel post to order again.`;
}

export function reportButton(orderId: string): Button {
  return { text: '⚠️ ችግር ሪፖርት አድርግ / Report a problem', data: reportCallbackData(orderId) };
}

export const reportReceived =
  'እናመሰግናለን / Thank you. The shop will check your payment and reply here.';

export const reportNotAvailable = 'This payment was already reported or decided.';

export const alreadyChecking = (orderId: string) =>
  `🔎 We are already checking the payment for order ${orderReference(orderId)}. We will confirm it here soon.`;

export const cbeAppLinkReply =
  'ይቅርታ / Sorry, Buchi cannot open this CBE receipt link. Please send the screenshot of the receipt, or its reference that starts with FT.';

export const receiptPageUnavailable =
  "ይቅርታ / Sorry, we could not open the bank's receipt page right now. Please send the screenshot of the receipt.";

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
    'The order is closed and its stock is back on sale. The customer can report a problem.',
  ].join('\n');
}

/** What owners read when a customer reports a rejected screenshot, with what Buchi read. */
export function reportedCaption(input: {
  orderId: string;
  total: MoneyString;
  reasons: string[];
  receipt: { amount: MoneyString; provider: string; txRef: string } | undefined;
  bank: BankCheck | null;
}): string {
  const { receipt } = input;
  const reasons = input.reasons.map((r) => (isRejectReason(r) ? rejectReasons[r] : r));
  return [
    `🙋 The customer reports a problem with the rejected payment for order ${orderReference(input.orderId)} · total ${formatBirr(input.total)}`,
    `Rejected because ${reasons.join('; ')}.`,
    receipt && `Screenshot: ${formatBirr(receipt.amount)} · ${receipt.provider} · ${receipt.txRef}`,
    input.bank && `Bank page: ${bankResults[input.bank]}`,
    'Approve sells the order if the item is still in stock. The screenshot is in Payment review.',
  ]
    .filter(Boolean)
    .join('\n');
}

function isRejectReason(reason: string): reason is RejectReason {
  return reason in rejectReasons;
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
