import { formatBirr } from '@buchi/shared';
import { Composer, Keyboard } from 'grammy';
import type { BuchiContext } from '../../telegram/actor';
import {
  acceptedNotice,
  deliveredReply,
  heldNotice,
  problemReply,
  receivedThanks,
  shareLocationPrompt,
} from './dispatch-messages.domain';
import type { AcceptResult, DispatchService } from './dispatch.service';
import { jobCallbackSchema, receiptCallbackSchema } from './drivers.schemas';
import type { OfferBonusService } from './offer-bonus.service';
import type { HoldResult, SpecialOffers } from './special-offers.service';
import type { TripService } from './trips.service';

interface DispatchDeps {
  dispatch: Pick<DispatchService, 'accept'>;
  trips: TripService;
  bonuses: Pick<OfferBonusService, 'raise'>;
  specialOffers: Pick<SpecialOffers, 'hold'>;
}

const acceptAnswers: Record<AcceptResult, string> = {
  accepted: 'The job is yours.',
  closed: 'Sorry, this job is no longer open.',
  not_found: 'Only drivers of this shop can take this job.',
};

const holdAnswers: Record<HoldResult, string> = {
  held: 'You hold this job until the customer pays.',
  closed: 'Sorry, this job is no longer open.',
  not_found: 'Only drivers of this shop can take this job.',
};

/**
 * Job buttons for drivers (**Accept** on an offer or a special offer, **Picked up**, **Delivered** and the location that
 * confirms it), the owners' **Add bonus**, and the customer's answer after a delivery. Buttons on
 * these messages act on an order, so they run before the takeover guard that relays customer chats.
 */
export function createDispatchHandlers(deps: DispatchDeps): Composer<BuchiContext> {
  const { dispatch, trips, bonuses, specialOffers } = deps;
  const handlers = new Composer<BuchiContext>();

  handlers.callbackQuery(/^job:/, async (ctx) => {
    const parsed = jobCallbackSchema.safeParse(ctx.callbackQuery.data);
    if (!parsed.success) {
      await ctx.answerCallbackQuery({ text: 'This button no longer works.' });
      return;
    }
    const { action, id } = parsed.data;
    const telegramUserId = ctx.actor.telegramUserId;
    switch (action) {
      case 'accept': {
        const result = await dispatch.accept(telegramUserId, id);
        await ctx.answerCallbackQuery({ text: acceptAnswers[result] });
        if (result === 'accepted') await ctx.editMessageText(acceptedNotice);
        return;
      }
      case 'hold': {
        const result = await specialOffers.hold(telegramUserId, id);
        await ctx.answerCallbackQuery({ text: holdAnswers[result] });
        if (result === 'held') await ctx.editMessageText(heldNotice);
        return;
      }
      case 'picked': {
        const pickedUp = await trips.pickedUp(telegramUserId, id);
        await ctx.answerCallbackQuery({
          text: pickedUp
            ? 'Customers know you are on the way.'
            : 'This job is not waiting for you.',
        });
        if (pickedUp) await ctx.editMessageReplyMarkup();
        return;
      }
      case 'delivered': {
        const requested = await trips.requestLocation(telegramUserId, id);
        await ctx.answerCallbackQuery(
          requested ? undefined : { text: 'This stop is not on your way.' },
        );
        if (!requested) return;
        await ctx.reply(shareLocationPrompt, {
          reply_markup: new Keyboard()
            .requestLocation('📍 ቦታ አጋራ / Share location')
            .oneTime()
            .resized(),
        });
        return;
      }
      case 'bonus': {
        const shopIds = ctx.actor.role === 'owner' ? ctx.actor.shopIds : [];
        const result = await bonuses.raise(shopIds, id);
        await ctx.answerCallbackQuery({
          text:
            result.status === 'raised'
              ? `Offered again at ${formatBirr(result.price)}.`
              : result.status === 'closed'
                ? 'A driver already took this job.'
                : "Only this shop's owners can do this.",
        });
        if (result.status !== 'not_found') await ctx.editMessageReplyMarkup();
        return;
      }
    }
  });

  handlers.on('message:location', async (ctx, next) => {
    if (ctx.actor.driverShopIds.length === 0) return next();
    const { latitude, longitude } = ctx.msg.location;
    const result = await trips.deliverPending(ctx.from.id, { latitude, longitude });
    if (result.status === 'not_found') return next();
    await ctx.reply(deliveredReply(result.orderId, result.jobDone), {
      reply_markup: { remove_keyboard: true },
    });
  });

  handlers.callbackQuery(/^receipt:/, async (ctx) => {
    const parsed = receiptCallbackSchema.safeParse(ctx.callbackQuery.data);
    const result = parsed.success
      ? await trips.confirmReceipt(ctx.from.id, parsed.data.id, parsed.data.action)
      : 'not_found';
    if (!parsed.success || result === 'not_found') {
      await ctx.answerCallbackQuery({ text: 'This button no longer works.' });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    if (result === 'recorded') {
      await ctx.reply(parsed.data.action === 'received' ? receivedThanks : problemReply);
    }
  });

  return handlers;
}
