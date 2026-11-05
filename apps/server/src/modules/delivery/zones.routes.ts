import { Router, type RequestHandler } from 'express';
import type { ZoneFactorService } from './zone-factors.service';

/** The owner's **Zones** map. The learned factors are platform-wide, so every owner sees one city. */
export function createZonesRouter(deps: {
  zoneFactors: Pick<ZoneFactorService, 'zoneMap'>;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { zoneFactors, requireAuth, requireShopOwner } = deps;
  const router = Router();

  router.get('/shops/:shopId/zones', requireAuth, requireShopOwner, async (_req, res) => {
    res.json(await zoneFactors.zoneMap());
  });

  return router;
}
