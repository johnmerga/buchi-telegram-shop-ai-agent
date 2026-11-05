import { placeQuerySchema } from '@buchi/shared';
import { Router, type RequestHandler } from 'express';
import { parseInput } from '../../http/validate';
import type { PlaceSearchService } from './places.service';

export function createPlacesRouter(deps: {
  places: Pick<PlaceSearchService, 'search'>;
  requireAuth: RequestHandler;
}): Router {
  const { places, requireAuth } = deps;
  const router = Router();

  router.get('/places', requireAuth, async (req, res) => {
    res.json(await places.search(parseInput(placeQuerySchema, req.query).q));
  });

  return router;
}
