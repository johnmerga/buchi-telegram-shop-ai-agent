import { Api } from 'grammy';
import { Readable } from 'node:stream';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connectDatabase } from '../../src/db/client';
import { createApp } from '../../src/http/app';
import { requireAuth } from '../../src/http/middleware/require-auth';
import { requireShopOwner } from '../../src/http/middleware/require-shop-owner';
import { AuthService } from '../../src/modules/auth/auth.service';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { createCatalogRouter } from '../../src/modules/catalog/catalog.routes';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { createShopsRouter } from '../../src/modules/shops/shops.routes';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { TelegramPhotoUploads } from '../../src/telegram/photo-uploads';
import { launchFields, signInitData } from '../sign-init-data';
import { testDatabaseUrl } from './test-database';
import { noEmbeddings } from '../fakes/no-embeddings';
import { noEvents } from '../fakes/no-events';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const botToken = '123456:test-token';
const auth = new AuthService({ botToken, tokenSecret: 't'.repeat(32), now: () => new Date() });
const unusedChannels = {
  verifyPostingRights: () => Promise.reject(new Error('not used')),
  publish: () => Promise.reject(new Error('not used')),
};
const shops = new ShopsService(db, new ShopsRepo(db), unusedChannels);
const catalog = new CatalogService(
  db,
  new CatalogRepo(),
  shops,
  unusedChannels,
  'buchi_test_bot',
  noEmbeddings,
  noEvents,
);
const guards = {
  requireAuth: requireAuth((token) => auth.verifyToken(token)),
  requireShopOwner: requireShopOwner((id) => shops.ownedShopIds(id)),
};
/** Telegram as the upload sees it: each sent photo gets file IDs for its sizes, largest last. */
const telegramCalls: { method: string; payload: Record<string, unknown> }[] = [];
const telegram = new Api('test');
telegram.config.use((_prev, method, payload) => {
  telegramCalls.push({ method, payload: { ...payload } });
  const result =
    method === 'sendPhoto'
      ? { message_id: 77, photo: [{ file_id: 'photo-small' }, { file_id: 'photo-large' }] }
      : true;
  // Only the fields the upload reads are filled in.
  return Promise.resolve({ ok: true, result } as never);
});
const openedFiles: string[] = [];
const photoFiles = {
  open: (fileId: string) => {
    openedFiles.push(fileId);
    return Promise.resolve({
      contentType: 'image/jpeg',
      body: Readable.from([Buffer.from('jpeg')]),
    });
  },
};
const app = createApp({
  logger: pino({ level: 'silent' }),
  trustProxyHops: 0,
  routers: [
    createShopsRouter({ shops, ...guards }),
    createCatalogRouter({
      catalog,
      uploads: new TelegramPhotoUploads(telegram),
      files: photoFiles,
      ...guards,
    }),
  ],
});

async function tokenFor(telegramUserId: number): Promise<string> {
  const initData = signInitData(launchFields(telegramUserId, new Date()), botToken);
  return (await auth.signInWithMiniApp(initData)).token;
}

describe('owner API', () => {
  it('lets an owner create a shop and a product, and keeps other users out', async () => {
    const owner = `Bearer ${await tokenFor(5001)}`;
    const stranger = `Bearer ${await tokenFor(5002)}`;

    const shop = await request(app)
      .post('/shops')
      .set('authorization', owner)
      .send({ name: 'Selam Shoes' });
    expect(shop.status).toBe(201);
    const { id: shopId } = z.object({ id: z.uuid() }).parse(shop.body);
    const products = `/shops/${shopId}/products`;

    const invalid = await request(app)
      .post(products)
      .set('authorization', owner)
      .send({ title: 'Nike Air', pricingMode: 'negotiable', price: '3000', lowestPrice: '3500' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const created = await request(app)
      .post(products)
      .set('authorization', owner)
      .send({ title: 'Nike Air', pricingMode: 'fixed', price: '3500' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ price: '3500.00', lowestPrice: null });

    const blocked = await request(app).get(products).set('authorization', stranger);
    expect(blocked.status).toBe(403);
  });

  it("adds a photo through the owner's bot chat and shows it only to the owner", async () => {
    const owner = `Bearer ${await tokenFor(5011)}`;
    const stranger = `Bearer ${await tokenFor(5012)}`;
    const shopId = await shops.create(5011, { name: 'Photo Shop' });
    const product = await catalog.createProduct(shopId, {
      title: 'Leather boots',
      description: '',
      pricingMode: 'fixed',
      price: '1000.00',
    });
    const photos = `/shops/${shopId}/products/${product.id}/photos`;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

    const blocked = await request(app)
      .post(photos)
      .set('authorization', stranger)
      .set('content-type', 'image/jpeg')
      .send(jpeg);
    expect(blocked.status).toBe(403);
    const unsigned = await request(app).post(photos).set('content-type', 'image/jpeg').send(jpeg);
    expect(unsigned.status).toBe(401);
    expect(telegramCalls).toEqual([]);

    const added = await request(app)
      .post(photos)
      .set('authorization', owner)
      .set('content-type', 'image/jpeg')
      .send(jpeg);
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ id: product.id, photoFileIds: ['photo-large'] });
    expect(telegramCalls.map((call) => call.method)).toEqual(['sendPhoto', 'deleteMessage']);
    expect(telegramCalls[0]?.payload).toMatchObject({ chat_id: 5011, disable_notification: true });
    expect(telegramCalls[1]?.payload).toEqual({ chat_id: 5011, message_id: 77 });

    const shown = await request(app).get(`${photos}/0`).set('authorization', owner);
    expect(shown.status).toBe(200);
    expect(shown.headers['content-type']).toBe('image/jpeg');
    expect(shown.headers['cache-control']).toBe('private, no-store');
    expect(openedFiles).toEqual(['photo-large']);
    expect((await request(app).get(`${photos}/1`).set('authorization', owner)).status).toBe(404);
    expect((await request(app).get(`${photos}/0`).set('authorization', stranger)).status).toBe(403);
  });

  it('refuses a photo that is not an image, too large, or for a product it cannot find', async () => {
    const owner = `Bearer ${await tokenFor(5013)}`;
    const shopId = await shops.create(5013, { name: 'Strict Shop' });
    const product = await catalog.createProduct(shopId, {
      title: 'Leather boots',
      description: '',
      pricingMode: 'fixed',
      price: '1000.00',
    });
    const photos = `/shops/${shopId}/products/${product.id}/photos`;
    const sent = telegramCalls.length;

    const gif = await request(app)
      .post(photos)
      .set('authorization', owner)
      .set('content-type', 'image/gif')
      .send(Buffer.from('GIF89a'));
    expect(gif.status).toBe(400);
    expect(gif.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const huge = await request(app)
      .post(photos)
      .set('authorization', owner)
      .set('content-type', 'image/png')
      .send(Buffer.alloc(10 * 1024 * 1024 + 1));
    expect(huge.status).toBe(413);
    expect(huge.body).toMatchObject({ error: { code: 'TOO_LARGE' } });
    expect(telegramCalls).toHaveLength(sent);

    const missing = await request(app)
      .post(`/shops/${shopId}/products/${shopId}/photos`)
      .set('authorization', owner)
      .set('content-type', 'image/png')
      .send(Buffer.from('png'));
    expect(missing.status).toBe(404);
  });
});
