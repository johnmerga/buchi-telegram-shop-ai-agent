import { formatBirr, type MoneyString } from '@buchi/shared';
import { orderReference } from '../orders/orders.domain';
import { deliveryChoiceCallback } from '../orders/orders.schemas';
import type { Button } from '../owner/owner.domain';

/** The customer's way out of a far quote: the item, picked up at the shop. */
export const pickupButton: Button = {
  text: '🏪 ከሱቁ መውሰድ / Pickup at the shop',
  data: deliveryChoiceCallback('pickup'),
};

/** The customer sees a price only once a driver holds it. */
export function priceFound(quote: {
  orderId: string;
  itemsTotal: MoneyString;
  fee: MoneyString;
  total: MoneyString;
}): string {
  return [
    `🛵 ሹፌር ተገኝቷል / A driver will deliver order ${orderReference(quote.orderId)}.`,
    `ዕቃዎች / Items: ${formatBirr(quote.itemsTotal)}`,
    `ማድረሻ / Delivery: ${formatBirr(quote.fee)}`,
    `ጠቅላላ / Total: ${formatBirr(quote.total)}`,
    'Confirm to get the payment details.',
  ].join('\n');
}

export function noPrice(orderId: string, driverHeld: boolean): string {
  const reason = driverHeld
    ? 'The delivery price was not confirmed within 20 minutes'
    : 'No driver took the delivery within 20 minutes';
  return [
    `⌛ ይቅርታ / Sorry: ${reason}, so order ${orderReference(orderId)} is released.`,
    'You can still pick it up at the shop.',
  ].join('\n');
}

export function pickupOffered(orderId: string): string {
  return [
    `ይቅርታ / Sorry: the shop cannot deliver order ${orderReference(orderId)} to your area now.`,
    'You can pick it up at the shop instead.',
  ].join('\n');
}

export const declinedReply =
  'እሺ / Okay, the order is cancelled. You can pick it up at the shop instead.';

/** The owner decides a price above the cap. Nothing above it reaches a driver without them. */
export function ownerApproval(quote: {
  orderId: string;
  routeMeters: number;
  formulaPayout: MoneyString;
  cap: MoneyString;
  price: MoneyString;
  reason: string;
}): string {
  return [
    `💰 Far delivery for ${orderReference(quote.orderId)} (${(quote.routeMeters / 1000).toFixed(1)} km) needs your OK.`,
    `Estimated driver price: ${formatBirr(quote.price)}, above your cap of ${formatBirr(quote.cap)}.`,
    `Formula payout: ${formatBirr(quote.formulaPayout)}. Why: ${quote.reason}`,
    'Approve this price once, or offer the customer pickup.',
  ].join('\n');
}
