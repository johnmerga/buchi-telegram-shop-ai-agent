import { deliverySettingsSchema, saverRunTimesSchema } from '@buchi/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validate';
import type { DeliveryService } from './delivery.service';
import type { SaverScheduleService } from './saver-schedule.service';

const shopParams = z.object({ shopId: z.uuid() });

export function createDeliveryRouter(deps: {
  delivery: DeliveryService;
  saverSchedule: SaverScheduleService;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { delivery, saverSchedule, requireAuth, requireShopOwner } = deps;
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

  router.put('/shops/:shopId/saver-run-times', requireAuth, requireShopOwner, async (req, res) => {
    const { shopId } = parseInput(shopParams, req.params);
    const { times } = parseInput(saverRunTimesSchema, req.body);
    await saverSchedule.setTimes(shopId, times);
    res.sendStatus(204);
  });

  return router;
}
