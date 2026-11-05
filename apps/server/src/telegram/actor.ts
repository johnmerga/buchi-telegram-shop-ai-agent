import type { Context, MiddlewareFn } from 'grammy';

/**
 * Who sent an update. `role` is what the user mainly is, for greetings. An owner can also drive
 * for a shop, so the shops a user drives for are separate from the role.
 */
export type Actor = { telegramUserId: number; driverShopIds: string[] } & (
  { role: 'owner'; shopIds: string[] } | { role: 'driver' } | { role: 'customer' }
);

export type BuchiContext = Context & { actor: Actor };

export type ResolveShops = (telegramUserId: number) => Promise<string[]>;

/**
 * Identifies the actor from the Telegram user ID, never from message text, so that a message
 * cannot claim a role. Updates without a sender carry nothing for Buchi to act on.
 */
export function actorMiddleware(resolve: {
  ownedShopIds: ResolveShops;
  driverShopIds: ResolveShops;
}): MiddlewareFn<BuchiContext> {
  return async (ctx, next) => {
    if (!ctx.from) return;
    const telegramUserId = ctx.from.id;
    const [shopIds, driverShopIds] = await Promise.all([
      resolve.ownedShopIds(telegramUserId),
      resolve.driverShopIds(telegramUserId),
    ]);
    const person = { telegramUserId, driverShopIds };
    if (shopIds.length > 0) ctx.actor = { ...person, role: 'owner', shopIds };
    else if (driverShopIds.length > 0) ctx.actor = { ...person, role: 'driver' };
    else ctx.actor = { ...person, role: 'customer' };
    await next();
  };
}
