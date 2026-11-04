import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './errors';
import { requireSecretHeader } from './require-secret-header';

const secret = 'a-secret-that-is-at-least-32-chars';

function protectedApp() {
  const app = express();
  app.get('/', requireSecretHeader('x-test-secret', secret), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe('requireSecretHeader', () => {
  it('lets a request with the right secret through', async () => {
    const res = await request(protectedApp()).get('/').set('x-test-secret', secret);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects a request without the header', async () => {
    const res = await request(protectedApp()).get('/');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects a wrong secret of the same length', async () => {
    const wrong = `${secret.slice(0, -1)}X`;
    const res = await request(protectedApp()).get('/').set('x-test-secret', wrong);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong secret of a different length', async () => {
    const res = await request(protectedApp()).get('/').set('x-test-secret', `${secret}extra`);
    expect(res.status).toBe(401);
  });

  it('rejects the secret sent in a different header', async () => {
    const res = await request(protectedApp()).get('/').set('x-other-secret', secret);
    expect(res.status).toBe(401);
  });
});
