import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { callerOf } from '../../http/caller';
import { parseInput } from '../../http/validate';
import type { OrderBoardService } from './order-board.service';
import type { OrderTrackingService } from './order-tracking.service';

const shopParams = z.object({ shopId: z.uuid() });
const orderParams = z.object({ orderId: z.uuid() });

export function createOrdersRouter(deps: {
  board: OrderBoardService;
  tracking: OrderTrackingService;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { board, tracking, requireAuth, requireShopOwner } = deps;
  const router = Router();

  router.get('/shops/:shopId/orders', requireAuth, requireShopOwner, async (req, res) => {
    res.json(await board.recent(parseInput(shopParams, req.params).shopId));
  });

  router.get('/customer/orders/:orderId', requireAuth, async (req, res) => {
    const { orderId } = parseInput(orderParams, req.params);
    res.json(await tracking.track(callerOf(req).telegramUserId, orderId));
  });

  return router;
}
