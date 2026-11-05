import { Composer } from 'grammy';
import { AppError } from '../../shared/errors';
import type { BuchiContext } from '../../telegram/actor';
import { inlineKeyboard } from '../../telegram/keyboards';
import { declinedReply, pickupButton } from './far-quote-messages.domain';
import type { FarQuoteOutcomes } from './far-quote-outcomes.service';
import type { FarQuoteService, OwnerAnswer } from './far-quotes.service';
import { farQuoteCallbackSchema } from './far-quotes.schemas';

interface FarQuoteDeps {
  quotes: Pick<FarQuoteService, 'ownerAnswered'>;
  outcomes: Pick<FarQuoteOutcomes, 'confirm' | 'decline'>;
}

const ownerAnswers: Record<OwnerAnswer, string> = {
  approved: 'Offered to your drivers at this price.',
  pickup: 'The customer was offered pickup.',
  closed: 'This quote has already ended.',
  not_found: "Only this shop's owners can do this.",
};

const noLongerWorks = 'This button no longer works.';

/**
 * The customer's **Confirm** and **Decline** for a price a driver holds, and the owner's
 * **Approve once** and **Offer pickup** for a price above the cap.
 */
export function createFarQuoteHandlers(deps: FarQuoteDeps): Composer<BuchiContext> {
  const { quotes, outcomes } = deps;
  const handlers = new Composer<BuchiContext>();

  handlers.callbackQuery(/^farquote:/, async (ctx) => {
    const parsed = farQuoteCallbackSchema.safeParse(ctx.callbackQuery.data);
    if (!parsed.success) {
      await ctx.answerCallbackQuery({ text: noLongerWorks });
      return;
    }
    const { action, id } = parsed.data;
    switch (action) {
      case 'approve':
      case 'pickup': {
        const owner = {
          telegramUserId: ctx.actor.telegramUserId,
          shopIds: ctx.actor.role === 'owner' ? ctx.actor.shopIds : [],
        };
        const answer = await quotes.ownerAnswered(owner, id, action === 'approve');
        await ctx.answerCallbackQuery({ text: ownerAnswers[answer] });
        if (answer !== 'not_found') await ctx.editMessageReplyMarkup();
        return;
      }
      case 'confirm': {
        const result = await customerAction(() => outcomes.confirm(ctx.from.id, id));
        if (result?.status !== 'accepted') {
          await ctx.answerCallbackQuery({ text: noLongerWorks });
          return;
        }
        await ctx.answerCallbackQuery();
        await ctx.editMessageReplyMarkup();
        await ctx.reply(result.instructions);
        return;
      }
      case 'decline': {
        const declined = await customerAction(() => outcomes.decline(ctx.from.id, id));
        await ctx.answerCallbackQuery(declined ? undefined : { text: noLongerWorks });
        if (!declined) return;
        await ctx.editMessageReplyMarkup();
        await ctx.reply(declinedReply, { reply_markup: inlineKeyboard([pickupButton]) });
        return;
      }
    }
  });

  return handlers;
}

/** An order of someone else, or one that moved on, makes the button stop working. */
async function customerAction<T>(act: () => Promise<T>): Promise<T | undefined> {
  try {
    return await act();
  } catch (err) {
    if (err instanceof AppError && (err.code === 'NOT_FOUND' || err.code === 'CONFLICT')) {
      return undefined;
    }
    throw err;
  }
}
