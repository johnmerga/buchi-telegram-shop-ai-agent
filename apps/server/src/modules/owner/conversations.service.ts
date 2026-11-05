import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { Conversation, ConversationsRepo } from './conversations.repo';
import type { MessageRef, Messenger, OwnerMessage, OwnerNotifier } from './owner-notifier.service';
import { handBackNotice, handBackTime, priceRequestAlert } from './owner.domain';

export const HAND_BACK_TIMER = 'conversation.hand_back';

interface TimerScheduler {
  schedule(kind: string, targetId: string, shopId: string | null, dueAt: Date): Promise<unknown>;
}

interface SwitchedToHuman {
  conversation: Conversation;
  switched: boolean;
}

interface ConversationCustomer {
  telegramUserId: number;
  name: string;
}

/**
 * Who answers a customer: Buchi (`agent` mode) or the shop's owners (`human` mode). In human mode,
 * customer messages go to the owners, and owner replies go back to the customer.
 */
export class ConversationService {
  constructor(
    private readonly db: Database,
    private readonly repo: ConversationsRepo,
    private readonly notifier: OwnerNotifier,
    private readonly messenger: Messenger,
    private readonly timers: TimerScheduler,
    private readonly now: () => Date,
  ) {}

  open(shopId: string, customer: ConversationCustomer): Promise<Conversation> {
    return withShop(this.db, shopId, (tx) => this.upsert(tx, shopId, customer));
  }

  /** The customer's conversation with the shop, if an owner is answering it. */
  async humanConversation(
    shopId: string,
    customerTelegramUserId: number,
  ): Promise<Conversation | undefined> {
    const conversation = await withShop(this.db, shopId, (tx) =>
      this.repo.findByCustomer(tx, customerTelegramUserId),
    );
    return conversation?.mode === 'human' ? conversation : undefined;
  }

  /** Until the sales agent negotiates (Task 4.2), an owner answers price questions in person. */
  async requestPrice(
    shopId: string,
    customer: ConversationCustomer,
    productTitle: string,
  ): Promise<void> {
    const switched = await withShop(this.db, shopId, async (tx) =>
      this.toHuman(tx, await this.upsert(tx, shopId, customer)),
    );
    const conversation = await this.startTimerIfSwitched(switched);
    await this.notifier.notify(conversation, { text: priceRequestAlert(productTitle) });
  }

  relayFromCustomer(conversation: Conversation, message: OwnerMessage): Promise<void> {
    return this.notifier.notify(conversation, message);
  }

  /** Returns `undefined` when none of the owner's shops has this conversation. */
  async takeOver(
    ownerShopIds: string[],
    conversationId: string,
  ): Promise<Conversation | undefined> {
    const switched = await this.inOwnedShop(ownerShopIds, async (tx) => {
      const conversation = await this.repo.find(tx, conversationId);
      return conversation && this.toHuman(tx, conversation);
    });
    return switched && this.startTimerIfSwitched(switched);
  }

  handBack(ownerShopIds: string[], conversationId: string): Promise<Conversation | undefined> {
    return this.inOwnedShop(ownerShopIds, async (tx) => {
      const conversation = await this.repo.find(tx, conversationId);
      return conversation && this.repo.setAgent(tx, conversation.id);
    });
  }

  /**
   * Sends an owner's reply to a relayed message on to its customer. A reply counts as the owner
   * taking over, so it also restarts the two hours of silence. Returns false for any other message.
   */
  async replyFromOwner(
    ownerShopIds: string[],
    reply: { repliedTo: MessageRef; message: MessageRef },
  ): Promise<boolean> {
    const switched = await this.inOwnedShop(ownerShopIds, async (tx) => {
      const found = await this.repo.findByRelay(
        tx,
        reply.repliedTo.chatId,
        reply.repliedTo.messageId,
      );
      return found && this.toHuman(tx, found);
    });
    if (!switched) return false;
    const conversation = await this.startTimerIfSwitched(switched);
    await this.messenger.copy(conversation.customerTelegramUserId, reply.message, { buttons: [] });
    return true;
  }

  /**
   * The hand-back timer handler. Owner replies move `hand_back_at` without a new timer, so an early
   * timer schedules the next check instead of handing back.
   */
  async handBackIfSilent(timer: { targetId: string; shopId: string | null }): Promise<void> {
    if (timer.shopId === null) throw new Error('A hand-back timer needs a shop');
    const { shopId, targetId } = timer;
    const now = this.now();
    const result = await withShop(this.db, shopId, async (tx) => {
      const handedBack = await this.repo.setAgentIfDue(tx, targetId, now);
      return handedBack ? { handedBack } : { pending: await this.repo.find(tx, targetId) };
    });
    if ('handedBack' in result) {
      await this.notifier.notify(result.handedBack, { text: handBackNotice });
      return;
    }
    const { pending } = result;
    if (pending?.mode === 'human' && pending.handBackAt) {
      await this.timers.schedule(HAND_BACK_TIMER, pending.id, shopId, pending.handBackAt);
    }
  }

  private upsert(
    tx: Transaction,
    shopId: string,
    customer: ConversationCustomer,
  ): Promise<Conversation> {
    return this.repo.upsert(tx, {
      shopId,
      customerTelegramUserId: customer.telegramUserId,
      customerName: customer.name,
    });
  }

  private async toHuman(tx: Transaction, conversation: Conversation): Promise<SwitchedToHuman> {
    const updated = await this.repo.setHuman(tx, conversation.id, handBackTime(this.now()));
    return { conversation: updated, switched: conversation.mode === 'agent' };
  }

  /**
   * Starts a hand-back timer, after the commit, only on the switch to human mode. Later owner
   * replies just move the deadline, which the running timer picks up.
   */
  private async startTimerIfSwitched({
    conversation,
    switched,
  }: SwitchedToHuman): Promise<Conversation> {
    if (switched && conversation.handBackAt) {
      await this.timers.schedule(
        HAND_BACK_TIMER,
        conversation.id,
        conversation.shopId,
        conversation.handBackAt,
      );
    }
    return conversation;
  }

  /** Row-level security finds the conversation only in a shop that the owner owns. */
  private async inOwnedShop<T>(
    ownerShopIds: string[],
    work: (tx: Transaction) => Promise<T | undefined>,
  ): Promise<T | undefined> {
    for (const shopId of ownerShopIds) {
      const found = await withShop(this.db, shopId, work);
      if (found) return found;
    }
    return undefined;
  }
}
