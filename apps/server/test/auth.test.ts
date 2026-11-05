import { Router } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/http/app';
import { callerOf } from '../src/http/caller';
import { requireAuth } from '../src/http/middleware/require-auth';
import { requireShopOwner } from '../src/http/middleware/require-shop-owner';
import { createAuthRouter } from '../src/modules/auth/auth.routes';
import { AuthService } from '../src/modules/auth/auth.service';
import { launchFields, signInitData } from './sign-init-data';

const logger = pino({ level: 'silent' });
const botToken = '123456:test-bot-token';
const signedInAt = new Date('2026-11-05T12:00:00Z');
const owner = 42;
const stranger = 7;
const shopId = '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f';

const sessionSchema = z.object({ token: z.string().min(1), expiresAt: z.iso.datetime() });

let now: Date;

function testApp() {
  const auth = new AuthService({
    botToken,
    tokenSecret: 'test-auth-token-secret-at-least-32-chars',
    now: () => now,
  });
  const ownedShopIds = (telegramUserId: number) =>
    Promise.resolve(telegramUserId === owner ? [shopId] : []);

  const shopRouter = Router();
  shopRouter.get(
    '/shops/:shopId/whoami',
    requireAuth((token) => auth.verifyToken(token)),
    requireShopOwner(ownedShopIds),
    (req, res) => {
      res.json(callerOf(req));
    },
  );
  return createApp({ logger, routers: [createAuthRouter(auth), shopRouter] });
}

function signInRequest(initData: string) {
  return request(testApp()).post('/auth/mini-app').send({ initData });
}

async function tokenFor(userId: number): Promise<string> {
  const res = await signInRequest(signInitData(launchFields(userId, now), botToken));
  return sessionSchema.parse(res.body).token;
}

beforeEach(() => {
  now = signedInAt;
});

describe('POST /auth/mini-app', () => {
  it('returns a token for valid launch data', async () => {
    const res = await signInRequest(signInitData(launchFields(owner, now), botToken));
    expect(res.status).toBe(200);
    expect(sessionSchema.parse(res.body).expiresAt).toBe('2026-11-06T00:00:00.000Z');
  });

  it('rejects tampered launch data', async () => {
    const params = new URLSearchParams(signInitData(launchFields(stranger, now), botToken));
    params.set('user', JSON.stringify({ id: owner }));
    const res = await signInRequest(params.toString());
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects stale launch data', async () => {
    const res = await signInRequest(signInitData(launchFields(owner, now, 25 * 60 * 60), botToken));
    expect(res.status).toBe(401);
  });

  it('rejects unsigned launch data', async () => {
    const res = await signInRequest(new URLSearchParams(launchFields(owner, now)).toString());
    expect(res.status).toBe(401);
  });

  it('rejects a body without initData', async () => {
    const res = await request(testApp()).post('/auth/mini-app').send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});

describe('shop routes', () => {
  const path = `/shops/${shopId}/whoami`;

  it('rejects a request without a token', async () => {
    const res = await request(testApp()).get(path);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects an Authorization header that is not a bearer token', async () => {
    const res = await request(testApp()).get(path).set('authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await request(testApp()).get(path).auth('not-a-token', { type: 'bearer' });
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await tokenFor(owner);
    now = new Date('2026-11-06T00:00:01Z');
    const res = await request(testApp()).get(path).auth(token, { type: 'bearer' });
    expect(res.status).toBe(401);
  });

  it('forbids a signed-in user who does not own the shop', async () => {
    const token = await tokenFor(stranger);
    const res = await request(testApp()).get(path).auth(token, { type: 'bearer' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('lets the owner through as the caller', async () => {
    const token = await tokenFor(owner);
    const res = await request(testApp()).get(path).auth(token, { type: 'bearer' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ telegramUserId: owner });
  });

  it('rejects a shop ID that is not a UUID', async () => {
    const token = await tokenFor(owner);
    const res = await request(testApp()).get('/shops/42/whoami').auth(token, { type: 'bearer' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
