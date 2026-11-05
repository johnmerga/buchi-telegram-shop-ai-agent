import { driverInviteSchema } from '@buchi/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validate';
import type { DriverService } from './drivers.service';

const shopParams = z.object({ shopId: z.uuid() });

export function createDriversRouter(deps: {
  drivers: DriverService;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { drivers, requireAuth, requireShopOwner } = deps;
  const router = Router();

  router.get('/shops/:shopId/drivers', requireAuth, requireShopOwner, async (req, res) => {
    res.json(await drivers.list(parseInput(shopParams, req.params).shopId));
  });

  /** Returns a one-time invite link for the owner to send to the driver. */
  router.post('/shops/:shopId/drivers', requireAuth, requireShopOwner, async (req, res) => {
    const { shopId } = parseInput(shopParams, req.params);
    const { username } = parseInput(driverInviteSchema, req.body);
    res.status(201).json(await drivers.invite(shopId, username));
  });

  return router;
}
