import { Composer, InputFile } from 'grammy';
import type { OwnerAssistant } from '../../ai/agents/owner-assistant/owner-assistant';
import type { BuchiContext } from '../../telegram/actor';
import type { CustomersService } from '../customers/customers.service';

interface AssistantDeps {
  assistant: Pick<OwnerAssistant, 'answer'>;
  customers: Pick<CustomersService, 'sessionOf'>;
}

/**
 * An owner's own words go to the owner assistant. It runs after the handlers for replies and
 * buttons, and before the sales agent. An owner who is buying from another shop is a customer
 * there, so their words go on to the sales agent.
 */
export function createAssistantHandlers({
  assistant,
  customers,
}: AssistantDeps): Composer<BuchiContext> {
  const handlers = new Composer<BuchiContext>();

  handlers.on('message:text', async (ctx, next) => {
    if (ctx.actor.role !== 'owner' || ctx.msg.text.startsWith('/')) return next();
    const { shopIds } = ctx.actor;
    const session = await customers.sessionOf(ctx.from.id);
    if (session && !shopIds.includes(session.shopId)) return next();
    const [shopId] = shopIds;
    if (!shopId || shopIds.length > 1) {
      await ctx.reply(
        'The assistant in this chat works for owners of one shop. Use the dashboard for each shop.',
      );
      return;
    }
    const answer = await assistant.answer(shopId, { telegramUserId: ctx.from.id }, ctx.msg.text);
    await ctx.reply(answer.text);
    if (answer.chart) await ctx.replyWithPhoto(new InputFile(answer.chart, 'chart.png'));
  });

  return handlers;
}
