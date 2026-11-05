import { Composer } from 'grammy';
import type { SalesAgent } from '../../ai/agents/sales/sales-agent';
import type { BuchiContext } from '../../telegram/actor';
import type { CustomersService } from '../customers/customers.service';

interface SalesDeps {
  agent: Pick<SalesAgent, 'answer'>;
  customers: Pick<CustomersService, 'sessionOf'>;
}

/**
 * Customer messages in their own words go to the sales agent. It runs after every other handler,
 * so buttons, commands, contacts, locations, and Maps links keep their code paths, and a chat in
 * human mode never reaches it.
 */
export function createSalesHandlers({ agent, customers }: SalesDeps): Composer<BuchiContext> {
  const handlers = new Composer<BuchiContext>();

  handlers.on('message:text', async (ctx, next) => {
    if (ctx.msg.text.startsWith('/')) return next();
    const session = await customers.sessionOf(ctx.from.id);
    // An owner talks to Buchi about their own shop through the owner tools, not as a customer.
    const ownShop = ctx.actor.role === 'owner' && ctx.actor.shopIds.includes(session?.shopId ?? '');
    if (!session || ownShop) return next();
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
    const answer = await agent.answer(
      session.shopId,
      { telegramUserId: ctx.from.id, name },
      ctx.msg.text,
    );
    await ctx.reply(answer.text);
  });

  return handlers;
}
