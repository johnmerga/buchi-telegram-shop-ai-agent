import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app';
import { createWebAppRouter } from '../src/http/web-app';

const logger = pino({ level: 'silent' });
let distDir: string;

beforeAll(async () => {
  distDir = await mkdtemp(join(tmpdir(), 'buchi-web-'));
  await mkdir(join(distDir, 'owner'));
  await mkdir(join(distDir, 'customer'));
  await mkdir(join(distDir, 'assets'));
  await writeFile(join(distDir, 'owner', 'index.html'), '<title>Owner</title>');
  await writeFile(join(distDir, 'customer', 'index.html'), '<title>Customer</title>');
  await writeFile(join(distDir, 'assets', 'owner-abc123.js'), 'console.log(1)');
});

afterAll(() => rm(distDir, { recursive: true }));

function directives(header: unknown): Map<string, string[]> {
  if (typeof header !== 'string') throw new Error('No content security policy');
  return new Map(
    header.split('; ').map((directive) => {
      const [name = '', ...values] = directive.split(' ');
      return [name, values];
    }),
  );
}

const app = () => createApp({ logger, trustProxyHops: 0, routers: [createWebAppRouter(distDir)] });

describe('web app serving', () => {
  it.each(['/app/owner', '/app/owner/', '/app/owner/orders/42'])(
    'serves the owner page at %s',
    async (path) => {
      const res = await request(app()).get(path);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<title>Owner</title>');
      expect(res.headers['cache-control']).toBe('no-cache');
    },
  );

  it('lets Telegram Web frame the page and load only Telegram, map tile, and own resources', async () => {
    const res = await request(app()).get('/app/owner/');
    const policy = directives(res.headers['content-security-policy']);
    expect(policy.get('frame-ancestors')).toEqual(["'self'", 'https://web.telegram.org']);
    expect(policy.get('script-src')).toEqual(["'self'", 'https://telegram.org', "'unsafe-eval'"]);
    expect(policy.get('img-src')).toContain('https://tile.openstreetmap.org');
    expect(policy.get('connect-src')).toEqual(["'self'"]);
    expect(policy.get('frame-src')).toEqual(['https://oauth.telegram.org']);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows eval and frames only on the owner page, which has the Login Widget', async () => {
    const res = await request(app()).get('/app/customer/');
    const policy = directives(res.headers['content-security-policy']);
    expect(policy.get('script-src')).toEqual(["'self'", 'https://telegram.org']);
    expect(policy.get('frame-src')).toEqual(["'none'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'self'", 'https://web.telegram.org']);
  });

  it('serves hashed assets with a long cache', async () => {
    const res = await request(app()).get('/app/assets/owner-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('sends the root to the owner app', async () => {
    const res = await request(app()).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/app/owner/');
  });

  it('answers a role whose page is missing with a JSON 404', async () => {
    const res = await request(app()).get('/app/driver/jobs');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('leaves the health check and unknown API paths alone', async () => {
    expect((await request(app()).get('/health')).body).toEqual({ status: 'ok' });
    const missing = await request(app()).get('/shops/nope');
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
