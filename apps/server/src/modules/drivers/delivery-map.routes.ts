import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validate';
import type { DeliveryMapService } from './delivery-map.service';

const shopParams = z.object({ shopId: z.uuid() });

/** The owner's **Deliveries** map, which reloads on the shop's live order events. */
export function createDeliveryMapRouter(deps: {
  deliveryMap: Pick<DeliveryMapService, 'map'>;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { deliveryMap, requireAuth, requireShopOwner } = deps;
  const router = Router();

  router.get('/shops/:shopId/deliveries', requireAuth, requireShopOwner, async (req, res) => {
    res.json(await deliveryMap.map(parseInput(shopParams, req.params).shopId));
  });

  return router;
}
