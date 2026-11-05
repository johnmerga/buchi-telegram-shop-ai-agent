import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fakeServer, json } from '../test/fakes';
import { Api } from './api';
import { ApiError } from './api-error';
import { Auth } from './auth';

const fixedAuth = (tokens: string[]) =>
  new Auth(() =>
    Promise.resolve({
      token: tokens.shift() ?? 'none',
      expiresAt: new Date(Date.now() + 3_600_000),
    }),
  );

const authHeader = (init: RequestInit | undefined) =>
  new Headers(init?.headers).get('authorization');

describe('Api', () => {
  it('sends the bearer token and parses the response with the schema', async () => {
    const { calls } = fakeServer({ 'GET /shops': () => json(200, [{ id: 'a' }]) });
    const shops = await new Api(fixedAuth(['t1'])).get(
      '/shops',
      z.array(z.object({ id: z.string() })),
    );
    expect(shops).toEqual([{ id: 'a' }]);
    expect(authHeader(calls[0]?.init)).toBe('Bearer t1');
  });

  it('signs in again once when the server rejects the token', async () => {
    let attempt = 0;
    const { calls } = fakeServer({
      'GET /shops': () => (attempt++ === 0 ? json(401, {}) : json(200, [])),
    });
    await new Api(fixedAuth(['old', 'new'])).get('/shops', z.array(z.unknown()));
    expect(calls.map((call) => authHeader(call.init))).toEqual(['Bearer old', 'Bearer new']);
  });

  it('turns an error response into an ApiError with the server’s code', async () => {
    fakeServer({
      'POST /shops/s1/channel': () =>
        json(409, { error: { code: 'CONFLICT', message: 'Already connected' } }),
    });
    const sent = new Api(fixedAuth(['t'])).send('POST', '/shops/s1/channel', {}, z.unknown());
    await expect(sent).rejects.toEqual(new ApiError(409, 'CONFLICT', 'Already connected'));
  });

  it('rejects a response that does not match the schema', async () => {
    fakeServer({ 'GET /shops': () => json(200, [{ id: 7 }]) });
    const shops = new Api(fixedAuth(['t'])).get('/shops', z.array(z.object({ id: z.string() })));
    await expect(shops).rejects.toThrow();
  });
});
