import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validate';
import type { LiveEvents } from './live-events.service';

const shopParams = z.object({ shopId: z.uuid() });

/** Render's proxy closes connections that stay silent, so an idle stream sends a comment. */
const HEARTBEAT_MS = 25_000;

/**
 * A shop's order changes as Server-Sent Events. The dashboard reads it with `fetch`, because
 * `EventSource` cannot send the bearer token.
 */
export function createLiveRouter(deps: {
  live: LiveEvents;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { live, requireAuth, requireShopOwner } = deps;
  const router = Router();

  router.get('/shops/:shopId/events', requireAuth, requireShopOwner, (req, res) => {
    const { shopId } = parseInput(shopParams, req.params);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    const stop = live.listen(shopId, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      stop();
    });
  });

  return router;
}
