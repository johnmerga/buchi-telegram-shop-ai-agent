import { formatBirr, type MoneyString } from '@buchi/shared';
import { InlineKeyboard, type Api } from 'grammy';
import type { OrderNotifier } from '../modules/orders/orders.deadlines.service';
import { orderReference } from '../modules/orders/orders.domain';
import { reorderCallbackData } from '../modules/orders/orders.schemas';

/** Sends a customer the messages about their unpaid order. */
export class TelegramOrderNotifier implements OrderNotifier {
  constructor(private readonly api: Api) {}

  async paymentReminder(
    chatId: number,
    reminder: { orderId: string; total: MoneyString; minutesLeft: number },
  ): Promise<void> {
    const reference = orderReference(reminder.orderId);
    const left = timeLeft(reminder.minutesLeft);
    await this.api.sendMessage(
      chatId,
      [
        `⏰ ትዕዛዝ ${reference} ገና አልተከፈለም / Order ${reference} is not paid yet.`,
        `ጠቅላላ / Total: ${formatBirr(reminder.total)}`,
        `ለመክፈል ${left} ቀርቷል / ${left} left to pay. Send the payment screenshot here.`,
      ].join('\n'),
    );
  }

  async orderExpired(chatId: number, orderId: string): Promise<void> {
    const reference = orderReference(orderId);
    await this.api.sendMessage(
      chatId,
      `⌛ የመክፈያ ጊዜው ስላለፈ ትዕዛዝ ${reference} ተሰርዟል / Order ${reference} expired because it was not paid in time.`,
      {
        reply_markup: new InlineKeyboard().text(
          'Order again / እንደገና እዘዝ',
          reorderCallbackData(orderId),
        ),
      },
    );
  }
}

function timeLeft(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = String(minutes % 60);
  return hours > 0 ? `${String(hours)} h ${rest} min` : `${rest} min`;
}
