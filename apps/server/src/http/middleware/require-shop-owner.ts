import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { callerOf } from '../caller';

const shopIdSchema = z.uuid();

/** For `/shops/:shopId/...` routes behind `requireAuth`: lets only the shop's owners through. */
export function requireShopOwner(
  ownedShopIds: (telegramUserId: number) => Promise<string[]>,
): RequestHandler {
  return async (req, _res, next) => {
    const shopId = shopIdSchema.safeParse(req.params.shopId);
    if (!shopId.success) throw new AppError('VALIDATION_FAILED', 'shopId must be a UUID');
    const owned = await ownedShopIds(callerOf(req).telegramUserId);
    if (!owned.includes(shopId.data)) throw new AppError('FORBIDDEN', 'You do not own this shop');
    next();
  };
}
