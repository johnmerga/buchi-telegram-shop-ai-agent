import { formatBirr, type MoneyString } from '@buchi/shared';
import { orderReference } from '../orders/orders.domain';

/** The design doc's rule: Buchi takes a chat back after two hours without an owner reply. */
const HAND_BACK_AFTER_MS = 2 * 60 * 60 * 1000;

type ConversationMode = 'agent' | 'human';

export interface Button {
  text: string;
  data: string;
}

export function handBackTime(lastOwnerActivity: Date): Date {
  return new Date(lastOwnerActivity.getTime() + HAND_BACK_AFTER_MS);
}

/** The one button an owner needs next: take over a chat that Buchi runs, or hand back their own. */
export function modeButton(conversation: { id: string; mode: ConversationMode }): Button {
  return conversation.mode === 'human'
    ? { text: '↩️ መልስ / Hand back', data: `handback:${conversation.id}` }
    : { text: '🙋 ተረከብ / Take over', data: `takeover:${conversation.id}` };
}

/** The first line of every owner message, so owners of several shops know whose chat it is. */
export function ownerMessageHeader(customerName: string, shopName: string): string {
  return `💬 ${customerName} · ${shopName}`;
}

export function orderAlert(order: {
  orderId: string;
  total: MoneyString;
  lines: { title: string; size: string; quantity: number }[];
}): string {
  const lines = order.lines.map(
    (line) =>
      `${line.title} · መጠን / size ${line.size}${line.quantity > 1 ? ` × ${String(line.quantity)}` : ''}`,
  );
  return [
    `🛒 አዲስ ትዕዛዝ / New order ${orderReference(order.orderId)}`,
    ...lines,
    `ጠቅላላ / Total: ${formatBirr(order.total)}`,
  ].join('\n');
}

export function priceRequestAlert(productTitle: string): string {
  return [
    `🏷️ ዋጋ ይጠይቃሉ / Asks the price of ${productTitle}.`,
    'Buchi has stopped replying. Reply to this message to answer.',
  ].join('\n');
}

export const handBackNotice =
  '🤖 No reply from you for two hours, so Buchi is answering this customer again.';
