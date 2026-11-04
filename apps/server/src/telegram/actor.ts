import type { Context, MiddlewareFn } from 'grammy';

export type Actor =
  | { role: 'owner'; telegramUserId: number; shopIds: string[] }
  | { role: 'customer'; telegramUserId: number };

export type BuchiContext = Context & { actor: Actor };

export type ResolveOwnedShops = (telegramUserId: number) => Promise<string[]>;

/**
 * Identifies the actor from the Telegram user ID, never from message text, so that a message
 * cannot claim a role. Updates without a sender carry nothing for Buchi to act on.
 */
export function actorMiddleware(ownedShopIds: ResolveOwnedShops): MiddlewareFn<BuchiContext> {
  return async (ctx, next) => {
    if (!ctx.from) return;
    const telegramUserId = ctx.from.id;
    const shopIds = await ownedShopIds(telegramUserId);
    ctx.actor =
      shopIds.length > 0
        ? { role: 'owner', telegramUserId, shopIds }
        : { role: 'customer', telegramUserId };
    await next();
  };
}
