import type { Logger } from 'pino';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { Conversation, ConversationsRepo, Relay } from './conversations.repo';
import { modeButton, ownerMessageHeader, type Button } from './owner.domain';

export interface MessageRef {
  chatId: number;
  messageId: number;
}

/** Sends Telegram messages and returns the new message's ID. Telegram is the only implementation. */
export interface Messenger {
  send(chatId: number, text: string, buttons: Button[]): Promise<number>;
  /** Copies a message of any kind. A `caption` replaces the original caption of a media message. */
  copy(
    chatId: number,
    source: MessageRef,
    options: { caption?: string; buttons: Button[] },
  ): Promise<number>;
}

interface ShopOwners {
  get(shopId: string): Promise<{ name: string }>;
  ownerIds(shopId: string): Promise<number[]>;
}

/** A text from Buchi, or a customer's message copied as it is. */
export type OwnerMessage = { text: string } | { copyOf: MessageRef; caption: string | undefined };

/** Tells every owner of a shop about one of its conversations. */
export class OwnerNotifier {
  constructor(
    private readonly db: Database,
    private readonly repo: ConversationsRepo,
    private readonly shops: ShopOwners,
    private readonly messenger: Messenger,
    private readonly logger: Logger,
  ) {}

  /**
   * Each owner gets the button for the conversation's mode. Every sent message is recorded, so an
   * owner's Telegram reply to it reaches the customer. One owner who blocked the bot does not stop
   * the others.
   */
  async notify(conversation: Conversation, message: OwnerMessage): Promise<void> {
    const { shopId } = conversation;
    const [shop, ownerIds] = await Promise.all([
      this.shops.get(shopId),
      this.shops.ownerIds(shopId),
    ]);
    const header = ownerMessageHeader(conversation.customerName, shop.name);
    const buttons = [modeButton(conversation)];

    const relays: Relay[] = [];
    for (const ownerId of ownerIds) {
      try {
        const messageId =
          'text' in message
            ? await this.messenger.send(ownerId, `${header}\n${message.text}`, buttons)
            : await this.messenger.copy(ownerId, message.copyOf, {
                caption: [header, message.caption].filter(Boolean).join('\n'),
                buttons,
              });
        relays.push({ ownerChatId: ownerId, messageId, shopId, conversationId: conversation.id });
      } catch (err) {
        // Only the message: a Telegram error object also holds the request, with the customer's text.
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.error({ shopId, reason }, 'owner notification failed');
      }
    }
    await withShop(this.db, shopId, (tx) => this.repo.recordRelays(tx, relays));
  }
}
