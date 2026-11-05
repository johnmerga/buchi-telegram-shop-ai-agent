import { and, eq, lte, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { conversations, relayedMessages, type ConversationTurn } from '../../db/schema';

export type Conversation = typeof conversations.$inferSelect;

/** A message that Buchi sent to an owner about a conversation. */
export interface Relay {
  ownerChatId: number;
  messageId: number;
  shopId: string;
  conversationId: string;
}

/** Every query runs inside `withShop`, so row-level security limits it to one shop. */
export class ConversationsRepo {
  /** Creates the conversation on first contact and keeps the customer's Telegram name current. */
  async upsert(
    tx: Transaction,
    values: { shopId: string; customerTelegramUserId: number; customerName: string },
  ): Promise<Conversation> {
    const [row] = await tx
      .insert(conversations)
      .values(values)
      .onConflictDoUpdate({
        target: [conversations.shopId, conversations.customerTelegramUserId],
        set: { customerName: sql`excluded.customer_name`, updatedAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error('Upsert returned no conversation');
    return row;
  }

  async findByCustomer(
    tx: Transaction,
    customerTelegramUserId: number,
  ): Promise<Conversation | undefined> {
    const [row] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.customerTelegramUserId, customerTelegramUserId));
    return row;
  }

  async find(tx: Transaction, id: string): Promise<Conversation | undefined> {
    const [row] = await tx.select().from(conversations).where(eq(conversations.id, id));
    return row;
  }

  /** The conversation that an owner's message replies to, if Buchi relayed that message. */
  async findByRelay(
    tx: Transaction,
    ownerChatId: number,
    messageId: number,
  ): Promise<Conversation | undefined> {
    const [row] = await tx
      .select({ conversation: conversations })
      .from(relayedMessages)
      .innerJoin(conversations, eq(conversations.id, relayedMessages.conversationId))
      .where(
        and(eq(relayedMessages.ownerChatId, ownerChatId), eq(relayedMessages.messageId, messageId)),
      );
    return row?.conversation;
  }

  async setHuman(tx: Transaction, id: string, handBackAt: Date): Promise<Conversation> {
    return this.update(tx, id, { mode: 'human', handBackAt });
  }

  async setAgent(tx: Transaction, id: string): Promise<Conversation> {
    return this.update(tx, id, { mode: 'agent', handBackAt: null });
  }

  /** Hands back only if no owner reply moved the deadline, in one statement to avoid a race. */
  async setAgentIfDue(tx: Transaction, id: string, now: Date): Promise<Conversation | undefined> {
    const [row] = await tx
      .update(conversations)
      .set({ mode: 'agent', handBackAt: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.mode, 'human'),
          lte(conversations.handBackAt, now),
        ),
      )
      .returning();
    return row;
  }

  async setTurns(tx: Transaction, id: string, turns: ConversationTurn[]): Promise<void> {
    await tx.update(conversations).set({ recentTurns: turns }).where(eq(conversations.id, id));
  }

  async recordRelays(tx: Transaction, relays: Relay[]): Promise<void> {
    if (relays.length > 0) await tx.insert(relayedMessages).values(relays);
  }

  private async update(
    tx: Transaction,
    id: string,
    values: Pick<Conversation, 'mode' | 'handBackAt'>,
  ): Promise<Conversation> {
    const [row] = await tx
      .update(conversations)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(conversations.id, id))
      .returning();
    if (!row) throw new Error('Conversation not found');
    return row;
  }
}
