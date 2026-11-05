import { Composer } from 'grammy';
import type { Message } from 'grammy/types';
import type { BuchiContext } from '../../telegram/actor';
import { inlineKeyboard } from '../../telegram/keyboards';
import { postIdFromStartPayload } from '../catalog/catalog.domain';
import type { CustomersService } from '../customers/customers.service';
import type { ConversationService } from './conversations.service';
import { modeButton } from './owner.domain';
import { modeActionSchema } from './owner.schemas';
import type { OwnerMessage } from './owner-notifier.service';

interface ConversationDeps {
  conversations: ConversationService;
  customers: Pick<CustomersService, 'sessionOf'>;
}

/**
 * Owner takeover inside Telegram: the **Take over** and **Hand back** buttons, owner replies to
 * relayed messages, and the guard that keeps Buchi quiet in human mode. It must run before every
 * handler that answers customers.
 */
export function createConversationHandlers(deps: ConversationDeps): Composer<BuchiContext> {
  const { conversations, customers } = deps;
  const handlers = new Composer<BuchiContext>();

  handlers.callbackQuery(/^(takeover|handback):/, async (ctx) => {
    const action = modeActionSchema.safeParse(ctx.callbackQuery.data);
    const shopIds = ctx.actor.role === 'owner' ? ctx.actor.shopIds : [];
    const conversation = !action.success
      ? undefined
      : action.data.action === 'takeover'
        ? await conversations.takeOver(shopIds, action.data.conversationId)
        : await conversations.handBack(shopIds, action.data.conversationId);
    if (!conversation) {
      await ctx.answerCallbackQuery({ text: "Only this shop's owners can do this." });
      return;
    }
    await ctx.answerCallbackQuery({
      text:
        conversation.mode === 'human'
          ? `You are answering ${conversation.customerName}. Reply to their messages here.`
          : `Buchi is answering ${conversation.customerName} again.`,
    });
    await ctx.editMessageReplyMarkup({ reply_markup: inlineKeyboard([modeButton(conversation)]) });
  });

  handlers.on('message', async (ctx, next) => {
    const repliedTo = ctx.msg.reply_to_message;
    if (ctx.actor.role !== 'owner' || !repliedTo) return next();
    const delivered = await conversations.replyFromOwner(ctx.actor.shopIds, {
      repliedTo: { chatId: ctx.chat.id, messageId: repliedTo.message_id },
      message: { chatId: ctx.chat.id, messageId: ctx.msg.message_id },
    });
    if (!delivered) await next();
  });

  // A Buy link passes, so a customer can always start buying, also from another shop.
  handlers.on(['message', 'callback_query'], async (ctx, next) => {
    if (isBuyLink(ctx.message)) return next();
    const session = await customers.sessionOf(ctx.from.id);
    const conversation =
      session && (await conversations.humanConversation(session.shopId, ctx.from.id));
    if (!conversation) return next();
    if (ctx.message) {
      await conversations.relayFromCustomer(conversation, ownerMessageOf(ctx.message));
    } else {
      await ctx.answerCallbackQuery();
    }
  });

  return handlers;
}

function isBuyLink(message: Message | undefined): boolean {
  const [command, payload] = message?.text?.split(' ') ?? [];
  return command === '/start' && payload !== undefined && !!postIdFromStartPayload(payload);
}

function ownerMessageOf(message: Message): OwnerMessage {
  return message.text === undefined
    ? {
        copyOf: { chatId: message.chat.id, messageId: message.message_id },
        caption: message.caption,
      }
    : { text: message.text };
}
