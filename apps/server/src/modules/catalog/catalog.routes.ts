import { productInputSchema, variantsInputSchema } from '@buchi/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validate';
import type { CatalogService } from './catalog.service';

const shopParams = z.object({ shopId: z.uuid() });
const productParams = shopParams.extend({ productId: z.uuid() });

/** Owner routes for products. Every route sits behind sign-in and the shop owner check. */
export function createCatalogRouter(deps: {
  catalog: CatalogService;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { catalog, requireAuth, requireShopOwner } = deps;
  const router = Router();

  router.get('/shops/:shopId/products', requireAuth, requireShopOwner, async (req, res) => {
    res.json(await catalog.listProducts(parseInput(shopParams, req.params).shopId));
  });

  router.post('/shops/:shopId/products', requireAuth, requireShopOwner, async (req, res) => {
    const { shopId } = parseInput(shopParams, req.params);
    res
      .status(201)
      .json(await catalog.createProduct(shopId, parseInput(productInputSchema, req.body)));
  });

  router.put(
    '/shops/:shopId/products/:productId',
    requireAuth,
    requireShopOwner,
    async (req, res) => {
      const { shopId, productId } = parseInput(productParams, req.params);
      res.json(
        await catalog.updateProduct(shopId, productId, parseInput(productInputSchema, req.body)),
      );
    },
  );

  router.put(
    '/shops/:shopId/products/:productId/variants',
    requireAuth,
    requireShopOwner,
    async (req, res) => {
      const { shopId, productId } = parseInput(productParams, req.params);
      await catalog.setVariants(shopId, productId, parseInput(variantsInputSchema, req.body));
      res.sendStatus(204);
    },
  );

  router.post(
    '/shops/:shopId/products/:productId/post',
    requireAuth,
    requireShopOwner,
    async (req, res) => {
      const { shopId, productId } = parseInput(productParams, req.params);
      res.status(201).json(await catalog.postToChannel(shopId, productId));
    },
  );

  return router;
}
