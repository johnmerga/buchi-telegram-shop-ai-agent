import { formatBirr, type ConversationItem, type MoneyString } from '@buchi/shared';
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

/** The dashboard shows the last few turns, enough to see what a chat is about. */
const LISTED_TURNS = 3;

/** A conversation as the owner's dashboard shows it, without the customer's Telegram ID. */
export function conversationItem(conversation: {
  id: string;
  customerName: string;
  mode: ConversationMode;
  handBackAt: Date | null;
  updatedAt: Date;
  recentTurns: ConversationItem['lastTurns'];
}): ConversationItem {
  return {
    id: conversation.id,
    customerName: conversation.customerName,
    mode: conversation.mode,
    handBackAt: conversation.handBackAt?.toISOString() ?? null,
    updatedAt: conversation.updatedAt.toISOString(),
    lastTurns: conversation.recentTurns.slice(-LISTED_TURNS),
  };
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

export function humanRequestAlert(reason: string): string {
  return [
    `🙋 ሰው ይፈልጋሉ / Needs you: ${reason}`,
    'Buchi has stopped replying. Reply to this message to answer.',
  ].join('\n');
}

/** The sales agent remembers this many messages, enough for one negotiation. */
const MAX_TURNS = 12;
/** A chat that went quiet for a day starts fresh, so old talk does not steer a new visit. */
const TURN_MEMORY_MS = 24 * 60 * 60 * 1000;

/** The turns still within the agent's memory window. */
export function currentTurns<Turn extends { at: string }>(turns: Turn[], now: Date): Turn[] {
  const oldest = now.getTime() - TURN_MEMORY_MS;
  return turns.filter((turn) => Date.parse(turn.at) >= oldest);
}

/** Adds turns and keeps only the latest ones within the memory window. */
export function appendTurns<Turn extends { at: string }>(
  turns: Turn[],
  added: Turn[],
  now: Date,
): Turn[] {
  return currentTurns([...turns, ...added], now).slice(-MAX_TURNS);
}

export const handBackNotice =
  '🤖 No reply from you for two hours, so Buchi is answering this customer again.';
