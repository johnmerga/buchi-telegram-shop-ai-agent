import { productInputSchema } from '@buchi/shared';
import { and, eq } from 'drizzle-orm';
import { Api } from 'grammy';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { demandSignals, products, timers as timersTable } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import type { ProductPhoto } from '../../src/modules/catalog/catalog.schemas';
import { PhotoSearchService } from '../../src/modules/catalog/photo-search.service';
import { ProductSearch } from '../../src/modules/catalog/product-search.service';
import {
  PRODUCT_EMBEDDING_TIMER,
  ProductEmbeddingService,
} from '../../src/modules/catalog/product-embeddings.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { DemandRepo } from '../../src/modules/demand/demand.repo';
import { DemandService } from '../../src/modules/demand/demand.service';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { AppError } from '../../src/shared/errors';
import { TelegramCustomerChat } from '../../src/telegram/customer-chat';
import { ScriptedModel, type ScriptedTurn } from '../fakes/scripted-model';
import { EventBus } from '../../src/shared/events';
import { testDatabaseUrl } from './test-database';
import { noEvents } from '../fakes/no-events';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

/**
 * Fixed fake embeddings: one dimension per word, so texts that share words are close. The small
 * constant keeps every vector non-zero, which cosine distance needs.
 */
const vocabulary = ['sneaker', 'high-top', 'white', 'boot', 'leather', 'black', 'dress', 'red'];
function fakeEmbedding(text: string): number[] {
  const vector = Array.from({ length: 768 }, () => 0);
  vector[767] = 0.05;
  for (const [index, word] of vocabulary.entries()) {
    if (text.toLowerCase().includes(word)) vector[index] = 1;
  }
  return vector;
}

const logger = pino({ level: 'silent' });
const script: ScriptedTurn[] = [];
const model = new ScriptedModel(script, fakeEmbedding);
const timers = new TimerService(new TimersRepo(db), logger);
const catalogRepo = new CatalogRepo();
const embeddings = new ProductEmbeddingService(
  db,
  catalogRepo,
  model,
  timers,
  () => new Date(),
  logger,
  noEvents,
);
timers.register(PRODUCT_EMBEDDING_TIMER, (timer) => embeddings.embed(timer));
const noTelegram = {
  verifyPostingRights: () => Promise.reject(new Error('unused')),
  publish: () => Promise.reject(new Error('unused')),
};
const shops = new ShopsService(db, new ShopsRepo(db), noTelegram);
const catalog = new CatalogService(db, catalogRepo, shops, noTelegram, 'bot', embeddings, noEvents);
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const demand = new DemandService(db, new DemandRepo(), new EventBus(logger));
const photos = new PhotoSearchService(db, catalogRepo, catalog, model, demand, logger);

const fixtures = [
  { title: 'White high-top sneakers', description: 'Canvas, white' },
  { title: 'Black leather boots', description: 'Ankle height' },
  { title: 'Red dress', description: 'Long, cotton' },
  { title: 'Leather belt', description: 'Black' },
];
const productIds = new Map<string, string>();
let shopId = '';
let customerId = '';
const image = { mimeType: 'image/jpeg', data: 'aW1hZ2U=' };
const describes = (photo: ProductPhoto): ScriptedTurn => ({ text: JSON.stringify(photo) });

const embeddingOf = async (productId: string) => {
  const [row] = await withShop(db, shopId, (tx) =>
    tx.select({ embedding: products.embedding }).from(products).where(eq(products.id, productId)),
  );
  return row?.embedding ?? null;
};
const pendingEmbeddingTimers = (productId: string) =>
  db
    .select()
    .from(timersTable)
    .where(
      and(
        eq(timersTable.kind, PRODUCT_EMBEDDING_TIMER),
        eq(timersTable.targetId, productId),
        eq(timersTable.status, 'pending'),
      ),
    );

beforeAll(async () => {
  shopId = await shops.create(880901, { name: 'Photo Shop' });
  customerId = (await customers.identify(shopId, 426001, 'Hana')).id;
  for (const fixture of fixtures) {
    const product = await catalog.createProduct(
      shopId,
      productInputSchema.parse({ ...fixture, pricingMode: 'fixed', price: '2000' }),
    );
    await catalog.setVariants(shopId, product.id, [{ size: 'M', color: null, stock: 2 }]);
    productIds.set(fixture.title, product.id);
  }
  await timers.tick();
});

describe('product embeddings', () => {
  it('embeds each new product in a background timer', async () => {
    for (const id of productIds.values()) {
      expect(await embeddingOf(id)).toHaveLength(768);
      expect(await pendingEmbeddingTimers(id)).toEqual([]);
    }
  });

  it('drops the embedding and embeds again when the text changes', async () => {
    const id = productIds.get('Red dress') ?? '';
    await catalog.updateProduct(
      shopId,
      id,
      productInputSchema.parse({
        title: 'Red dress',
        description: 'Short, silk',
        pricingMode: 'fixed',
        price: '2500',
      }),
    );
    expect(await embeddingOf(id)).toBeNull();
    expect(await pendingEmbeddingTimers(id)).toHaveLength(1);

    await timers.tick();
    expect(await embeddingOf(id)).toHaveLength(768);
  });

  it('keeps the embedding when only the price changes', async () => {
    const id = productIds.get('Leather belt') ?? '';
    await catalog.updateProduct(
      shopId,
      id,
      productInputSchema.parse({ ...fixtures[3], pricingMode: 'fixed', price: '900' }),
    );
    expect(await embeddingOf(id)).toHaveLength(768);
    expect(await pendingEmbeddingTimers(id)).toEqual([]);
  });

  it('tries again in an hour when Gemini is unavailable', async () => {
    const quotaOut = new ProductEmbeddingService(
      db,
      catalogRepo,
      { embed: () => Promise.reject(new AppError('QUOTA_EXHAUSTED', 'No quota')) },
      timers,
      () => new Date('2026-11-05T12:00:00Z'),
      logger,
      noEvents,
    );
    const product = await catalog.createProduct(
      shopId,
      productInputSchema.parse({ title: 'Blue jeans', pricingMode: 'fixed', price: '1500' }),
    );
    await db
      .delete(timersTable)
      .where(and(eq(timersTable.targetId, product.id), eq(timersTable.status, 'pending')));

    await quotaOut.embed({ targetId: product.id, shopId });

    expect(await embeddingOf(product.id)).toBeNull();
    expect(await pendingEmbeddingTimers(product.id)).toMatchObject([
      { shopId, dueAt: new Date('2026-11-05T13:00:00Z') },
    ]);
  });
});

describe('photo search', () => {
  it.each([
    [
      { category: 'high-top sneakers', colors: ['white'], brand: null, style: 'canvas' },
      'White high-top sneakers',
    ],
    [
      { category: 'ankle boots', colors: ['black'], brand: null, style: 'leather' },
      'Black leather boots',
    ],
    [{ category: 'dress', colors: ['red'], brand: null, style: 'silk, short' }, 'Red dress'],
  ])('finds the right product in the top three for %j', async (photo, expected) => {
    script.push(describes(photo));

    const result = await photos.search(shopId, customerId, image);

    expect(result.status).toBe('found');
    const titles = result.status === 'found' ? result.products.map((p) => p.title) : [];
    expect(titles.length).toBeLessThanOrEqual(3);
    expect(titles).toContain(expected);
  });

  it('records unmet demand and offers Notify me when nothing is similar', async () => {
    script.push(describes({ category: 'handbag', colors: ['brown'], brand: 'Gucci', style: '' }));

    const result = await photos.search(shopId, customerId, image);

    expect(result.status).toBe('not_found');
    const signalId = result.status === 'not_found' ? result.signalId : '';
    const sent: Record<string, unknown>[] = [];
    const api = new Api('test');
    api.config.use((_prev, _method, payload) => {
      sent.push({ ...payload });
      return Promise.resolve({ ok: true, result: { message_id: 1 } } as never);
    });
    if (result.status !== 'unavailable') await new TelegramCustomerChat(api).photoSearch(1, result);
    expect(JSON.stringify(sent)).toContain(`notify:${signalId}`);

    expect(await demand.requestNotify(shopId, customerId, signalId)).toBe(true);
    const [signal] = await withShop(db, shopId, (tx) =>
      tx.select().from(demandSignals).where(eq(demandSignals.id, signalId)),
    );
    expect(signal).toMatchObject({
      customerId,
      description: 'handbag; brown; Gucci',
      notifyRequested: true,
    });
  });

  it('lets only the customer who sent the photo ask to be notified', async () => {
    script.push(describes({ category: 'handbag', colors: [], brand: null, style: '' }));
    const result = await photos.search(shopId, customerId, image);
    const other = await customers.identify(shopId, 426002, 'Dawit');

    const signalId = result.status === 'not_found' ? result.signalId : '';
    expect(await demand.requestNotify(shopId, other.id, signalId)).toBe(false);
  });

  it('reports the search as unavailable when the model answers with something else', async () => {
    script.push({ text: 'a pair of shoes' });
    expect(await photos.search(shopId, customerId, image)).toEqual({ status: 'unavailable' });
  });

  it('reports the search as unavailable when Gemini has no quota left', async () => {
    script.push({ error: new AppError('QUOTA_EXHAUSTED', 'No quota') });
    expect(await photos.search(shopId, customerId, image)).toEqual({ status: 'unavailable' });
  });

  it('reports the search as unavailable when the photo cannot be embedded', async () => {
    const noEmbeddings = new ScriptedModel(script);
    const search = new PhotoSearchService(db, catalogRepo, catalog, noEmbeddings, demand, logger);
    script.push(describes({ category: 'sneakers', colors: ['white'], brand: null, style: '' }));
    expect(await search.search(shopId, customerId, image)).toEqual({ status: 'unavailable' });
  });
});

describe('product search by words and meaning', () => {
  /** Amharic words as the fake embedding reads them, as a real embedding model would place them. */
  const amharic: Record<string, string> = { 'ነጭ ስኒከር': 'white high-top sneaker', ቦርሳ: 'bag' };
  const embedder = {
    embed: (text: string) => Promise.resolve(fakeEmbedding(amharic[text] ?? text)),
  };
  const search = new ProductSearch(db, catalogRepo, catalog, embedder, logger);
  const titles = async (query: string, limit = 5) =>
    (await search.search(shopId, query, limit)).map((product) => product.title);

  it('finds a product by meaning when no word of the query is in its listing', async () => {
    expect(await titles('ነጭ ስኒከር')).toEqual(['White high-top sneakers']);
  });

  it('lists products found by words first, then close ones once each', async () => {
    const found = await titles('leather');
    expect(found.slice(0, 2).toSorted()).toEqual(['Black leather boots', 'Leather belt']);
    expect(new Set(found).size).toBe(found.length);
  });

  it('finds nothing for a query that is close to no product', async () => {
    expect(await titles('ቦርሳ')).toEqual([]);
  });

  it('keeps to the limit', async () => {
    expect(await titles('leather', 1)).toHaveLength(1);
  });

  it('keeps the products found by words when the query cannot be embedded', async () => {
    const offline = new ProductSearch(
      db,
      catalogRepo,
      catalog,
      { embed: () => Promise.reject(new Error('quota')) },
      logger,
    );
    expect((await offline.search(shopId, 'leather', 5)).map((p) => p.title).toSorted()).toEqual([
      'Black leather boots',
      'Leather belt',
    ]);
    expect(await offline.search(shopId, 'ነጭ ስኒከር', 5)).toEqual([]);
  });
});
