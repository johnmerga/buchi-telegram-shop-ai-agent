import { deliverySettingsSchema } from '@buchi/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validate';
import type { DeliveryService } from './delivery.service';

const shopParams = z.object({ shopId: z.uuid() });

export function createDeliveryRouter(deps: {
  delivery: DeliveryService;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { delivery, requireAuth, requireShopOwner } = deps;
  const router = Router();

  router.put(
    '/shops/:shopId/delivery-settings',
    requireAuth,
    requireShopOwner,
    async (req, res) => {
      const { shopId } = parseInput(shopParams, req.params);
      await delivery.saveSettings(shopId, parseInput(deliverySettingsSchema, req.body));
      res.sendStatus(204);
    },
  );

  return router;
}
