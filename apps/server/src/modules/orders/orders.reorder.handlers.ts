import { Composer } from 'grammy';
import { AppError } from '../../shared/errors';
import type { BuchiContext } from '../../telegram/actor';
import type { CheckoutService } from './checkout.service';
import { reorderCallbackSchema } from './orders.schemas';

/** Handles the **Order again** button that comes with an expiry message. */
export function createReorderHandlers(checkout: CheckoutService): Composer<BuchiContext> {
  const reorder = new Composer<BuchiContext>();

  reorder.on('callback_query:data', async (ctx, next) => {
    const orderId = reorderCallbackSchema.safeParse(ctx.callbackQuery.data);
    if (!orderId.success) {
      await next();
      return;
    }
    await ctx.answerCallbackQuery();
    // Removing the button before ordering keeps a second tap from placing the order twice.
    await ctx.editMessageReplyMarkup();
    try {
      await ctx.reply(await checkout.reorder(ctx.actor.telegramUserId, orderId.data));
    } catch (err) {
      if (err instanceof AppError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND')) {
        await ctx.reply(
          `ይቅርታ፣ እንደገና ማዘዝ አልተቻለም / Sorry, we could not order again: ${err.message}.`,
        );
        return;
      }
      throw err;
    }
  });

  return reorder;
}
