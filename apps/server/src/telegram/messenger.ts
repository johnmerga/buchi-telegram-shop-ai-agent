import type { Api } from 'grammy';
import type { Button } from '../modules/owner/owner.domain';
import type { MessageRef, Messenger } from '../modules/owner/owner-notifier.service';
import { inlineKeyboard } from './keyboards';

const markup = (buttons: Button[]) =>
  buttons.length > 0 ? { reply_markup: inlineKeyboard(buttons) } : {};

/** Messages between Buchi, customers, and owners in private chats. */
export class TelegramMessenger implements Messenger {
  constructor(private readonly api: Api) {}

  async send(chatId: number, text: string, buttons: Button[]): Promise<number> {
    const message = await this.api.sendMessage(chatId, text, markup(buttons));
    return message.message_id;
  }

  async copy(
    chatId: number,
    source: MessageRef,
    options: { caption?: string; buttons: Button[] },
  ): Promise<number> {
    const caption = options.caption === undefined ? {} : { caption: options.caption };
    const message = await this.api.copyMessage(chatId, source.chatId, source.messageId, {
      ...caption,
      ...markup(options.buttons),
    });
    return message.message_id;
  }

  async edit(message: MessageRef, text: string, buttons: Button[]): Promise<void> {
    await this.api.editMessageText(message.chatId, message.messageId, text, markup(buttons));
  }
}
