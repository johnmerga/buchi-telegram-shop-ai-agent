import { Composer } from 'grammy';
import type { BuchiContext } from '../../telegram/actor';
import type { CustomersService } from '../customers/customers.service';
import type { DemandService } from './demand.service';
import { notifyCallbackSchema } from './demand.schemas';

interface DemandDeps {
  demand: Pick<DemandService, 'requestNotify'>;
  customers: Pick<CustomersService, 'sessionOf' | 'byTelegramUser'>;
}

/** The **Notify me** button that follows a photo search without a match. */
export function createDemandHandlers({ demand, customers }: DemandDeps): Composer<BuchiContext> {
  const handlers = new Composer<BuchiContext>();

  handlers.on('callback_query:data', async (ctx, next) => {
    const signalId = notifyCallbackSchema.safeParse(ctx.callbackQuery.data);
    if (!signalId.success) return next();
    const session = await customers.sessionOf(ctx.from.id);
    const customer = session && (await customers.byTelegramUser(session.shopId, ctx.from.id));
    const noted =
      session && customer
        ? await demand.requestNotify(session.shopId, customer.id, signalId.data)
        : false;
    await ctx.answerCallbackQuery({
      text: noted
        ? '🔔 እናሳውቅዎታለን / We will message you when something like it arrives.'
        : 'ይቅርታ / Sorry, send the photo again, please.',
    });
    if (noted) await ctx.editMessageReplyMarkup();
  });

  return handlers;
}
