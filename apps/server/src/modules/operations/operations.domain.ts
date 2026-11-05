import { formatBirr, type MoneyString } from '@buchi/shared';
import { addisClockTime } from '../../shared/time';
import { orderReference } from '../orders/orders.domain';

/** A customer message counts as near the payment deadline within this many minutes of it. */
export const NEAR_DEADLINE_MINUTES = 30;

/** The design doc's example: a waitlist of 10 people for a sold-out size is worth a restock. */
export const WAITLIST_THRESHOLD = 10;

/** True while the deadline is still ahead but at most `NEAR_DEADLINE_MINUTES` away. */
export function isNearDeadline(deadline: Date | null, now: Date): boolean {
  if (deadline === null) return false;
  const left = deadline.getTime() - now.getTime();
  return left > 0 && left <= NEAR_DEADLINE_MINUTES * 60_000;
}

/** Only the join that reaches the threshold counts, so one waitlist wakes the agent once. */
export function reachesWaitlistThreshold(waiting: number): boolean {
  return waiting === WAITLIST_THRESHOLD;
}

export function deadlineExtended(orderId: string, deadline: Date): string {
  const time = addisClockTime(deadline);
  return `⏰ ትዕዛዝ ${orderReference(orderId)}: እስከ ${time} መክፈል ይችላሉ / You can pay for order ${orderReference(orderId)} until ${time} (Addis Ababa time).`;
}

export function newArrivalTime(orderId: string, arrival: Date): string {
  const time = addisClockTime(arrival);
  return `🕒 ትዕዛዝ ${orderReference(orderId)} በ${time} አካባቢ ይደርሳል / Order ${orderReference(orderId)} should arrive around ${time}.`;
}

export function driverContact(driver: { name: string; phone: string }): string {
  return `📞 ሹፌር / Driver ${driver.name}: ${driver.phone}`;
}

export function rescheduledForCustomer(orderId: string): string {
  return `📦 ትዕዛዝ ${orderReference(orderId)} በሚቀጥለው ዙር ይደርሳል / We could not reach you, so order ${orderReference(orderId)} comes with the next delivery run.`;
}

export function rescheduledForDriver(orderId: string): string {
  return `↪️ ${orderReference(orderId)} moves to the next run. Keep it at the shop and continue your route.`;
}

export function exchangeReserved(orderId: string, size: string): string {
  return `🔄 መጠን ${size} ተይዞልዎታል / Size ${size} is reserved for your exchange of order ${orderReference(orderId)}. The shop will contact you to swap it.`;
}

export function exchangeAlert(orderId: string, sizes: { from: string; to: string }): string {
  return `🔄 Size exchange for ${orderReference(orderId)}: ${sizes.from} → ${sizes.to}. Size ${sizes.to} is reserved. Please arrange the swap with the customer.`;
}

export function refundApproved(orderId: string, amount: MoneyString): string {
  return `💸 የ${formatBirr(amount)} ተመላሽ ተፈቅዷል / The shop approved a refund of ${formatBirr(amount)} for order ${orderReference(orderId)}. The owner will send it to you.`;
}

export function restockComing(product: { title: string; size: string }): string {
  return `📦 ${product.title} መጠን ${product.size} በቅርቡ ይመጣል / The shop is restocking ${product.title} in size ${product.size}. We will message you when it arrives.`;
}

export function problemQuestion(orderId: string): string {
  return `ይቅርታ / Sorry! What is wrong with order ${orderReference(orderId)}?`;
}

export function problemForOwner(orderId: string): string {
  return `⚠️ Reports a problem with delivered order ${orderReference(orderId)}. Reply to answer.`;
}

export const sizeQuestion = 'የትኛው መጠን ይስማማዎታል? / Which size do you need?';
export const problemNoted = 'እናመሰግናለን / Thank you. Buchi is on it and will message you here.';
