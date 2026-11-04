import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { actorMiddleware, type BuchiContext, type ResolveOwnedShops } from './actor';

export interface BotDeps {
  token: string;
  ownedShopIds: ResolveOwnedShops;
  /** Tests pass bot info to skip the `getMe` call that `bot.init()` makes. */
  botInfo?: UserFromGetMe;
}

export function createBot({ token, ownedShopIds, botInfo }: BotDeps): Bot<BuchiContext> {
  const bot = new Bot<BuchiContext>(token, botInfo ? { botInfo } : {});
  bot.use(actorMiddleware(ownedShopIds));
  bot.command('start', (ctx) =>
    ctx.reply(
      ctx.actor.role === 'owner'
        ? 'ሰላም! Welcome back. Buchi is watching your shop.'
        : 'ሰላም! I am Buchi. Tap Buy on a channel post to start an order.',
    ),
  );
  return bot;
}
