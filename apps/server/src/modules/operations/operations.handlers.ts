import { Composer } from 'grammy';
import type { BuchiContext } from '../../telegram/actor';
import { oneButtonPerRow } from '../../telegram/keyboards';
import type { CustomersService } from '../customers/customers.service';
import type { CustomerProblems } from './customer-problems.service';
import { problemNoted, sizeQuestion } from './operations.domain';
import {
  problemCallbackSchema,
  wantedSizeCallbackData,
  wantedSizeCallbackSchema,
} from './operations.schemas';
import type { OperationsTriggers } from './operations-triggers.service';

interface OperationsDeps {
  triggers: Pick<OperationsTriggers, 'customerMessage' | 'driverMessage'>;
  problems: Pick<CustomerProblems, 'report' | 'chooseSize' | 'resolve'>;
  customers: Pick<CustomersService, 'sessionOf'>;
}

const stale = 'This button no longer works.';

/**
 * The Telegram events that wake the operations agent: a customer's **Problem** answers, a
 * driver's message during a trip, and a customer's message close to the payment deadline. It runs
 * after the takeover guard and just before the sales agent, which answers everything else.
 */
export function createOperationsHandlers(deps: OperationsDeps): Composer<BuchiContext> {
  const { triggers, problems, customers } = deps;
  const handlers = new Composer<BuchiContext>();

  handlers.callbackQuery(/^problem:/, async (ctx) => {
    const parsed = problemCallbackSchema.safeParse(ctx.callbackQuery.data);
    if (!parsed.success) return ctx.answerCallbackQuery({ text: stale });
    const { orderId, kind } = parsed.data;
    const result = await problems.report(ctx.from.id, orderId, kind);
    if (result.status === 'not_found' || result.status === 'already_reported') {
      return ctx.answerCallbackQuery({ text: stale });
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    if (result.status === 'ask_size') {
      const buttons = result.sizes.flatMap((size) => {
        const data = wantedSizeCallbackData(orderId, size);
        return data === undefined ? [] : [{ text: size, data }];
      });
      await ctx.reply(sizeQuestion, { reply_markup: oneButtonPerRow(buttons) });
      return;
    }
    await ctx.reply(problemNoted);
    await problems.resolve(result.shopId, orderId, kind, undefined);
  });

  handlers.callbackQuery(/^xsize:/, async (ctx) => {
    const parsed = wantedSizeCallbackSchema.safeParse(ctx.callbackQuery.data);
    if (!parsed.success) return ctx.answerCallbackQuery({ text: stale });
    const { orderId, size } = parsed.data;
    const result = await problems.chooseSize(ctx.from.id, orderId, size);
    if (result.status !== 'recorded') return ctx.answerCallbackQuery({ text: stale });
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    await ctx.reply(problemNoted);
    await problems.resolve(result.shopId, orderId, 'wrong_size', size);
  });

  handlers.on('message:text', async (ctx, next) => {
    const { text } = ctx.msg;
    if (text.startsWith('/')) return next();
    if (ctx.actor.driverShopIds.length > 0 && (await triggers.driverMessage(ctx.from.id, text))) {
      await ctx.reply(problemNoted);
      return;
    }
    const session = await customers.sessionOf(ctx.from.id);
    const ownShop = ctx.actor.role === 'owner' && ctx.actor.shopIds.includes(session?.shopId ?? '');
    if (!session || ownShop) return next();
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
    const handled = await triggers.customerMessage(
      session.shopId,
      { telegramUserId: ctx.from.id, name },
      text,
    );
    if (!handled) await next();
  });

  return handlers;
}
