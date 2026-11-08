import {
  connectChannelSchema,
  createShopSchema,
  deleteShopSchema,
  paymentAccountsSchema,
  shopLocationSchema,
} from '@buchi/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { callerOf } from '../../http/caller';
import { parseInput } from '../../http/validate';
import type { ShopsService } from './shops.service';

const shopParams = z.object({ shopId: z.uuid() });

export function createShopsRouter(deps: {
  shops: ShopsService;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { shops, requireAuth, requireShopOwner } = deps;
  const router = Router();

  router.post('/shops', requireAuth, async (req, res) => {
    const id = await shops.create(
      callerOf(req).telegramUserId,
      parseInput(createShopSchema, req.body),
    );
    res.status(201).json({ id });
  });

  router.get('/shops', requireAuth, async (req, res) => {
    res.json(await shops.listOwned(callerOf(req).telegramUserId));
  });

  router.get('/shops/:shopId', requireAuth, requireShopOwner, async (req, res) => {
    res.json(await shops.get(parseInput(shopParams, req.params).shopId));
  });

  router.delete('/shops/:shopId', requireAuth, requireShopOwner, async (req, res) => {
    const { shopId } = parseInput(shopParams, req.params);
    await shops.delete(shopId, parseInput(deleteShopSchema, req.body).name);
    res.sendStatus(204);
  });

  router.put('/shops/:shopId/location', requireAuth, requireShopOwner, async (req, res) => {
    const { shopId } = parseInput(shopParams, req.params);
    await shops.setLocation(shopId, parseInput(shopLocationSchema, req.body));
    res.sendStatus(204);
  });

  router.put('/shops/:shopId/payment-accounts', requireAuth, requireShopOwner, async (req, res) => {
    const { shopId } = parseInput(shopParams, req.params);
    await shops.setPaymentAccounts(shopId, parseInput(paymentAccountsSchema, req.body));
    res.sendStatus(204);
  });

  router.post('/shops/:shopId/channel', requireAuth, requireShopOwner, async (req, res) => {
    const { shopId } = parseInput(shopParams, req.params);
    const { channel } = parseInput(connectChannelSchema, req.body);
    res.json(await shops.connectChannel(shopId, channel));
  });

  return router;
}
