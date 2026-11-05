import { Bot, type Composer } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { actorMiddleware, type BuchiContext, type ResolveShops } from './actor';

export interface BotDeps {
  token: string;
  ownedShopIds: ResolveShops;
  driverShopIds: ResolveShops;
  handlers: Composer<BuchiContext>[];
  /** Fetched once at startup with `getMe`, because services also need the bot's ID and username. */
  botInfo: UserFromGetMe;
}

const greetings: Record<BuchiContext['actor']['role'], string> = {
  owner: 'ሰላም! Welcome back. Buchi is watching your shop.',
  driver: 'ሰላም! Welcome back. Send /duty to go available or off duty.',
  customer: 'ሰላም! I am Buchi. Tap Buy on a channel post to start an order.',
};

export function createBot(deps: BotDeps): Bot<BuchiContext> {
  const { token, ownedShopIds, driverShopIds, handlers, botInfo } = deps;
  const bot = new Bot<BuchiContext>(token, { botInfo });
  bot.use(actorMiddleware({ ownedShopIds, driverShopIds }));
  // Handlers run before the greeting, so `/start` with a Buy link payload reaches its handler.
  for (const handler of handlers) bot.use(handler);
  bot.command('start', (ctx) => ctx.reply(greetings[ctx.actor.role]));
  return bot;
}
