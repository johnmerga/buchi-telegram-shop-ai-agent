import type { Server } from 'node:http';
import { Router, type RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app';
import { callerOf } from '../src/http/caller';
import { requireShopOwner } from '../src/http/middleware/require-shop-owner';
import { limitSignedInUsers, publicRateLimits } from '../src/http/rate-limits';

const logger = pino({ level: 'silent' });
const shopId = '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f';
const servers: Server[] = [];

/** Signs in whoever sends `x-user`, so the tests choose the Telegram user without tokens. */
const fakeAuth: RequestHandler = (req, _res, next) => {
  req.caller = { telegramUserId: Number(req.get('x-user')) };
  next();
};

/** Stand-ins for the real routes, which the limits sit in front of. */
function endpoints(): Router {
  const router = Router();
  const ok: RequestHandler = (_req, res) => {
    res.sendStatus(200);
  };
  router.post('/auth/mini-app', ok);
  router.post('/telegram/webhook', ok);
  router.post('/jobs/tick', ok);
  const signedIn = limitSignedInUsers(fakeAuth, () => new Date());
  const shopOwner = requireShopOwner(() => Promise.resolve([shopId]));
  router.get('/shops/:shopId/orders', signedIn, shopOwner, (req, res) => {
    res.json({ shopId: req.params.shopId, user: callerOf(req).telegramUserId });
  });
  return router;
}

/** One listening server per app, so hundreds of requests do not each open a server. */
function listen(trustProxyHops: number): Server {
  const app = createApp({
    logger,
    trustProxyHops,
    routers: [publicRateLimits(() => new Date()), endpoints()],
  });
  const server = app.listen(0);
  servers.push(server);
  return server;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function sendMany(times: number, send: () => request.Test): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i += 1) statuses.push((await send()).status);
  return statuses;
}

describe('rate limits', () => {
  it.each([
    ['/auth/mini-app', 60],
    ['/telegram/webhook', 1_200],
    ['/jobs/tick', 30],
  ])('allows %s %i times a minute from one address, then refuses with 429', async (path, limit) => {
    const server = listen(1);
    const send = () => request(server).post(path).set('x-forwarded-for', '196.188.1.1');

    expect(new Set(await sendMany(limit, send))).toEqual(new Set([200]));

    const refused = await send();
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    const otherAddress = await request(server).post(path).set('x-forwarded-for', '196.188.1.2');
    expect(otherAddress.status).toBe(200);
  });

  it('ignores a forged X-Forwarded-For when no proxy is trusted', async () => {
    const server = listen(0);
    let forged = 0;
    const send = () =>
      request(server)
        .post('/jobs/tick')
        .set('x-forwarded-for', `10.0.0.${String((forged += 1))}`);

    const statuses = await sendMany(31, send);

    expect(statuses.at(-1)).toBe(429);
  });

  it('limits each signed-in Telegram user on their own, even behind one address', async () => {
    const server = listen(1);
    const send = (user: number) =>
      request(server)
        .get(`/shops/${shopId}/orders`)
        .set('x-forwarded-for', '196.188.1.1')
        .set('x-user', String(user));

    expect(new Set(await sendMany(120, () => send(1)))).toEqual(new Set([200]));

    expect((await send(1)).status).toBe(429);
    const other = await send(2);
    expect(other.status).toBe(200);
    expect(other.body).toEqual({ shopId, user: 2 });
  });
});
