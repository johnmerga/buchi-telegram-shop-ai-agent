import { Bot, type Composer } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { actorMiddleware, type BuchiContext, type ResolveOwnedShops } from './actor';

export interface BotDeps {
  token: string;
  ownedShopIds: ResolveOwnedShops;
  handlers: Composer<BuchiContext>[];
  /** Fetched once at startup with `getMe`, because services also need the bot's ID and username. */
  botInfo: UserFromGetMe;
}

export function createBot({ token, ownedShopIds, handlers, botInfo }: BotDeps): Bot<BuchiContext> {
  const bot = new Bot<BuchiContext>(token, { botInfo });
  bot.use(actorMiddleware(ownedShopIds));
  bot.command('start', (ctx) =>
    ctx.reply(
      ctx.actor.role === 'owner'
        ? 'ሰላም! Welcome back. Buchi is watching your shop.'
        : 'ሰላም! I am Buchi. Tap Buy on a channel post to start an order.',
    ),
  );
  for (const handler of handlers) bot.use(handler);
  return bot;
}
