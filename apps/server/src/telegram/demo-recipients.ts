import type { Transformer } from 'grammy';
import type { Logger } from 'pino';
import { isDemoTelegramId } from '../shared/demo-ids';

/**
 * Skips every Bot API call to a demo customer or driver, whose made-up user ID has no chat. The
 * call answers like a sent message, so whatever sent it carries on as it would for a real person.
 */
export function skipDemoRecipients(logger: Pick<Logger, 'info'>): Transformer {
  return (prev, method, payload, signal) => {
    const chatId = (payload as { chat_id?: unknown } | undefined)?.chat_id;
    if (typeof chatId !== 'number' || !isDemoTelegramId(chatId)) {
      return prev(method, payload, signal);
    }
    logger.info({ method }, 'skipped a demo recipient');
    const sent = { message_id: 0, date: 0, chat: { id: chatId, type: 'private', first_name: '' } };
    return Promise.resolve({ ok: true as const, result: sent as never });
  };
}
