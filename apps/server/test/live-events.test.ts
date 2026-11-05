import type { AddressInfo } from 'node:net';
import { liveEventSchema } from '@buchi/shared';
import { pino } from 'pino';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app';
import { requireAuth } from '../src/http/middleware/require-auth';
import { requireShopOwner } from '../src/http/middleware/require-shop-owner';
import { AuthService } from '../src/modules/auth/auth.service';
import { LiveEvents } from '../src/modules/live/live-events.service';
import { createLiveRouter } from '../src/modules/live/live.routes';
import { launchFields, signInitData } from './sign-init-data';

const botToken = '123456:test-bot-token';
const owner = 42;
const stranger = 7;
const shopId = '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f';
const otherShopId = '0b9d8c7a-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
const orderId = '3d6f0a2b-1c4e-4b5a-8d7c-9e0f1a2b3c4d';

const auth = new AuthService({
  botToken,
  tokenSecret: 'test-auth-token-secret-at-least-32-chars',
  now: () => new Date(),
});
const live = new LiveEvents();
const app = createApp({
  logger: pino({ level: 'silent' }),
  routers: [
    createLiveRouter({
      live,
      requireAuth: requireAuth((token) => auth.verifyToken(token)),
      requireShopOwner: requireShopOwner((id) => Promise.resolve(id === owner ? [shopId] : [])),
    }),
  ],
});
const server = app.listen(0);
// A server listening on a TCP port always reports an AddressInfo, never a pipe name.
const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
const aborts: AbortController[] = [];

afterEach(() => {
  for (const abort of aborts.splice(0)) abort.abort();
});
afterAll(() => {
  server.close();
});

async function open(userId: number | undefined): Promise<Response> {
  const abort = new AbortController();
  aborts.push(abort);
  const headers: Record<string, string> = {};
  if (userId !== undefined) {
    const { token } = await auth.signInWithMiniApp(
      signInitData(launchFields(userId, new Date()), botToken),
    );
    headers.authorization = `Bearer ${token}`;
  }
  return fetch(`${base}/shops/${shopId}/events`, { headers, signal: abort.signal });
}

/** Reads the stream until it holds a `data:` line, which it parses. */
async function nextEvent(res: Response): Promise<unknown> {
  if (!res.body) throw new Error('No body');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error('Stream ended');
    text += value;
    const data = /^data: (.+)$/m.exec(text)?.[1];
    if (data !== undefined) return JSON.parse(data);
  }
}

describe('GET /shops/:shopId/events', () => {
  it('streams only the shop’s own events to its owner', async () => {
    const res = await open(owner);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const event = nextEvent(res);
    live.publish(otherShopId, { type: 'order.created', orderId });
    live.publish(shopId, { type: 'order.transitioned', orderId, from: 'paid', to: 'dispatching' });
    expect(liveEventSchema.parse(await event)).toEqual({
      type: 'order.transitioned',
      orderId,
      from: 'paid',
      to: 'dispatching',
    });
  });

  it('rejects a request without a token', async () => {
    const res = await open(undefined);
    expect(res.status).toBe(401);
  });

  it('forbids a signed-in user who does not own the shop', async () => {
    const res = await open(stranger);
    expect(res.status).toBe(403);
  });
});

describe('LiveEvents', () => {
  it('stops delivering to a listener that stopped listening', () => {
    const hub = new LiveEvents();
    const received: unknown[] = [];
    const stop = hub.listen(shopId, (event) => received.push(event));
    hub.publish(shopId, { type: 'order.created', orderId });
    stop();
    hub.publish(shopId, { type: 'order.created', orderId });
    expect(received).toHaveLength(1);
  });
});
