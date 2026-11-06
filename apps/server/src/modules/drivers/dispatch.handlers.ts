import { Composer, Keyboard } from 'grammy';
import type { BuchiContext } from '../../telegram/actor';
import {
  acceptedNotice,
  deliveredReply,
  driverProblemPrompt,
  heldNotice,
  receivedThanks,
  shareLocationPrompt,
} from './dispatch-messages.domain';
import type { AcceptResult, DispatchService } from './dispatch.service';
import { jobCallbackSchema, receiptCallbackSchema } from './drivers.schemas';
import { liveShareOf } from './live-location.domain';
import type { LiveTracking } from './live-tracking.service';
import type { HoldResult, SpecialOffers } from './special-offers.service';
import type { TripService } from './trips.service';

interface DispatchDeps {
  dispatch: Pick<DispatchService, 'accept'>;
  trips: TripService;
  tracking: Pick<LiveTracking, 'driverMoved'>;
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
 * Job buttons for drivers (**Accept** on an offer or a special offer, **Picked up**, **Delivered**
 * and the location that confirms it, and **Problem**), the driver's Live Location that customers
 * follow, and the customer's answer after a delivery.
 * Buttons on these messages act on an order, so they run before the takeover guard that relays
 * customer chats.
 */
export function createDispatchHandlers(deps: DispatchDeps): Composer<BuchiContext> {
  const { dispatch, trips, tracking, specialOffers } = deps;
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
        const result = await trips.delivered(telegramUserId, id);
        if (result.status === 'not_found') {
          await ctx.answerCallbackQuery({ text: 'This stop is not on your way.' });
          return;
        }
        await ctx.answerCallbackQuery();
        if (result.status === 'delivered') {
          await ctx.reply(deliveredReply(result.orderId, result.jobDone));
          return;
        }
        await ctx.reply(shareLocationPrompt, {
          reply_markup: new Keyboard()
            .requestLocation('📍 ቦታ አጋራ / Share location')
            .oneTime()
            .resized(),
        });
        return;
      }
      case 'problem': {
        // The driver's next message reaches the operations agent while the trip is active.
        await ctx.answerCallbackQuery();
        await ctx.reply(driverProblemPrompt);
        return;
      }
    }
  });

  // A location after **Delivered** confirms that stop. A Live Location also starts customers' maps.
  handlers.on('message:location', async (ctx, next) => {
    if (ctx.actor.driverShopIds.length === 0) return next();
    const { latitude, longitude, live_period: livePeriod } = ctx.msg.location;
    const result = await trips.deliverPending(ctx.from.id, { latitude, longitude });
    if (result.status === 'delivered') {
      await ctx.reply(deliveredReply(result.orderId, result.jobDone), {
        reply_markup: { remove_keyboard: true },
      });
    }
    const followed =
      livePeriod !== undefined && (await tracking.driverMoved(ctx.from.id, liveShareOf(ctx.msg)));
    if (result.status === 'not_found' && !followed) return next();
  });

  // Telegram sends each move of a Live Location, and its end, as an edit of the first message.
  handlers.on('edited_message:location', async (ctx, next) => {
    if (ctx.actor.driverShopIds.length === 0) return next();
    if (!(await tracking.driverMoved(ctx.from.id, liveShareOf(ctx.editedMessage)))) return next();
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
    // A problem report continues with the questions the operations module asks.
    if (result === 'recorded' && parsed.data.action === 'received') {
      await ctx.reply(receivedThanks);
    }
  });

  return handlers;
}
