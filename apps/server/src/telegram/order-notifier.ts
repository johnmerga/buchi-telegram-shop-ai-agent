import { InlineKeyboard, type Api } from 'grammy';
import type { OrderNotifier } from '../modules/orders/orders.deadlines.service';
import { orderReference } from '../modules/orders/orders.domain';
import { reorderCallbackData } from '../modules/orders/orders.schemas';

/** Sends a customer the messages about their unpaid order. */
export class TelegramOrderNotifier implements OrderNotifier {
  constructor(private readonly api: Api) {}

  async orderExpired(chatId: number, orderId: string): Promise<void> {
    const reference = orderReference(orderId);
    await this.api.sendMessage(
      chatId,
      `⌛ የመክፈያ ጊዜው አልፏል፣ ትዕዛዝ ${reference} ተሰርዟል / Time ran out to pay for order ${reference}, so the item is back on sale. Tap Order again when you are ready.`,
      {
        reply_markup: new InlineKeyboard().text(
          'Order again / እንደገና እዘዝ',
          reorderCallbackData(orderId),
        ),
      },
    );
  }
}
