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
const app = createApp({
  logger: pino({ level: 'silent' }),
  routers: [createShopsRouter({ shops, ...guards }), createCatalogRouter({ catalog, ...guards })],
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
});
