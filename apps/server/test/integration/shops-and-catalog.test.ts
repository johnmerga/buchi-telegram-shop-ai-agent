import { productInputSchema, type ProductInput } from '@buchi/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { customers, orderItems, orders, productVariants } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService, type ChannelPublisher } from '../../src/modules/catalog/catalog.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService, type ChannelVerifier } from '../../src/modules/shops/shops.service';
import { testDatabaseUrl } from './test-database';
import { noEmbeddings } from '../fakes/no-embeddings';
import { noEvents } from '../fakes/no-events';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

let nextChatId = -1001000000001;
const verifier: ChannelVerifier = {
  verifyPostingRights: (channel) =>
    Promise.resolve({
      chatId: channel === '@taken' ? -1001999999999 : nextChatId--,
      title: channel,
    }),
};

function services(publish: ChannelPublisher['publish'] = () => Promise.resolve(42)) {
  const shops = new ShopsService(db, new ShopsRepo(db), verifier);
  const published: Parameters<ChannelPublisher['publish']>[0][] = [];
  const unpublished: { chatId: number; messageId: number }[] = [];
  const catalog = new CatalogService(
    db,
    new CatalogRepo(),
    { channelChatId: async (shopId) => (await shops.get(shopId)).channelChatId },
    {
      publish: (post) => {
        published.push(post);
        return publish(post);
      },
      unpublish: (post) => {
        unpublished.push(post);
        return Promise.resolve();
      },
    },
    'buchi_test_bot',
    noEmbeddings,
    noEvents,
  );
  return { shops, catalog, published, unpublished };
}

const fixed: ProductInput = productInputSchema.parse({
  title: 'Nike Air',
  pricingMode: 'fixed',
  price: '3500',
});
const negotiable: ProductInput = productInputSchema.parse({
  title: 'Adidas Samba',
  pricingMode: 'negotiable',
  price: '4200',
  lowestPrice: '3800',
});

describe('ShopsService', () => {
  it('creates a shop owned by the caller', async () => {
    const { shops } = services();
    const shopId = await shops.create(9001, { name: 'Selam Shoes' });

    expect((await shops.listOwned(9001)).map((s) => s.id)).toEqual([shopId]);
    expect(await shops.listOwned(9002)).toEqual([]);
  });

  it('replaces payment accounts and saves the location', async () => {
    const { shops } = services();
    const shopId = await shops.create(9003, { name: 'Abebe Fashion' });
    const account = {
      provider: 'telebirr' as const,
      accountName: 'Abebe',
      accountNumber: '0911000000',
    };

    await shops.setPaymentAccounts(shopId, [account]);
    await shops.setPaymentAccounts(shopId, [{ ...account, accountNumber: '0911111111' }]);
    await shops.setLocation(shopId, { latitude: 8.9806, longitude: 38.7578 });

    const shop = await shops.get(shopId);
    expect(shop.paymentAccounts.map((a) => a.accountNumber)).toEqual(['0911111111']);
    expect(shop.latitude).toBe(8.9806);
  });

  it('refuses a channel that another shop already connected', async () => {
    const { shops } = services();
    const first = await shops.create(9004, { name: 'First' });
    const second = await shops.create(9005, { name: 'Second' });

    await shops.connectChannel(first, '@taken');
    await expect(shops.connectChannel(second, '@taken')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('CatalogService', () => {
  async function shopWithChannel(ownerId: number) {
    const s = services();
    const shopId = await s.shops.create(ownerId, { name: `Shop ${String(ownerId)}` });
    await s.shops.connectChannel(shopId, `@channel${String(ownerId)}`);
    return { ...s, shopId };
  }

  it('posts a fixed-price product with its price and a Buy link', async () => {
    const { catalog, published, shopId } = await shopWithChannel(9101);
    const product = await catalog.createProduct(shopId, fixed);
    await catalog.setVariants(shopId, product.id, [
      { size: '41', color: null, stock: 2 },
      { size: '40', color: null, stock: 0 },
    ]);

    const { postId } = await catalog.postToChannel(shopId, product.id);

    expect(published).toHaveLength(1);
    expect(published[0]?.caption).toContain('3,500.00 ብር');
    expect(published[0]?.caption).toContain('Sizes: 41');
    expect(published[0]?.buttonUrl).toBe(
      `https://t.me/buchi_test_bot?start=p_${postId.replaceAll('-', '')}`,
    );
  });

  it('hides the price of a negotiable product', async () => {
    const { catalog, published, shopId } = await shopWithChannel(9102);
    const product = await catalog.createProduct(shopId, negotiable);
    await catalog.setVariants(shopId, product.id, [{ size: '42', color: null, stock: 1 }]);

    await catalog.postToChannel(shopId, product.id);

    expect(published[0]?.caption).not.toMatch(/4,200|3,800/);
  });

  it('refuses to post without a channel or without stock', async () => {
    const { shops, catalog } = services();
    const noChannel = await shops.create(9103, { name: 'No channel' });
    const product = await catalog.createProduct(noChannel, fixed);
    await expect(catalog.postToChannel(noChannel, product.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const withChannel = await shopWithChannel(9104);
    const soldOut = await withChannel.catalog.createProduct(withChannel.shopId, fixed);
    await expect(
      withChannel.catalog.postToChannel(withChannel.shopId, soldOut.id),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('removes the post record when Telegram rejects the post', async () => {
    const s = services(() => Promise.reject(new Error('Telegram is down')));
    const shopId = await s.shops.create(9105, { name: 'Down' });
    await s.shops.connectChannel(shopId, '@down_channel');
    const product = await s.catalog.createProduct(shopId, fixed);
    await s.catalog.setVariants(shopId, product.id, [{ size: '40', color: null, stock: 1 }]);

    await expect(s.catalog.postToChannel(shopId, product.id)).rejects.toThrow('Telegram is down');
    const posts = await withShop(db, shopId, (tx) =>
      tx.execute(sql`select count(*)::int as n from channel_posts`),
    );
    expect(posts[0]).toEqual({ n: 0 });
  });

  it('refuses stock below the units that open orders reserve', async () => {
    const { catalog, shopId } = await shopWithChannel(9106);
    const product = await catalog.createProduct(shopId, fixed);
    await catalog.setVariants(shopId, product.id, [{ size: '40', color: null, stock: 3 }]);
    await withShop(db, shopId, (tx) => tx.update(productVariants).set({ reserved: 2 }));

    await expect(
      catalog.setVariants(shopId, product.id, [{ size: '40', color: null, stock: 1 }]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("cannot attach a variant to another shop's product", async () => {
    const a = await shopWithChannel(9107);
    const b = await shopWithChannel(9108);
    const productOfB = await b.catalog.createProduct(b.shopId, fixed);

    await expect(
      withShop(db, a.shopId, (tx) =>
        tx.insert(productVariants).values({
          shopId: a.shopId,
          productId: productOfB.id,
          size: '40',
          stock: 1,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  async function productWithSize(ownerId: number) {
    const s = await shopWithChannel(ownerId);
    const product = await s.catalog.createProduct(s.shopId, fixed);
    await s.catalog.setVariants(s.shopId, product.id, [{ size: '40', color: null, stock: 2 }]);
    const [variant] = await withShop(db, s.shopId, (tx) => tx.select().from(productVariants));
    if (!variant) throw new Error('No size');
    return { ...s, product, variant };
  }

  it('deletes a product that no order names, with its sizes and posts', async () => {
    const { catalog, shopId, product, unpublished } = await productWithSize(9109);
    const { postId } = await catalog.postToChannel(shopId, product.id);

    expect(await catalog.removeProduct(shopId, product.id)).toEqual({ removed: 'deleted' });
    expect(unpublished.map((post) => post.messageId)).toEqual([42]);

    expect(await catalog.listProducts(shopId)).toEqual([]);
    expect(await catalog.openPost(postId)).toBeUndefined();
    const left = await withShop(db, shopId, (tx) =>
      tx.execute(sql`select (select count(*) from product_variants)::int as sizes,
        (select count(*) from channel_posts)::int as posts`),
    );
    expect(left[0]).toEqual({ sizes: 0, posts: 0 });
  });

  it('switches off a product with orders, keeps the orders, and restores it', async () => {
    const { catalog, shopId, product, variant, unpublished } = await productWithSize(9110);
    const { postId } = await catalog.postToChannel(shopId, product.id);
    await withShop(db, shopId, async (tx) => {
      const [customer] = await tx
        .insert(customers)
        .values({ shopId, telegramUserId: 9110001, name: 'Abebe' })
        .returning({ id: customers.id });
      const [order] = await tx
        .insert(orders)
        .values({
          shopId,
          customerId: customer?.id ?? '',
          status: 'delivered',
          deliveryType: 'pickup',
          itemsTotal: '3500',
          total: '3500',
        })
        .returning({ id: orders.id });
      await tx.insert(orderItems).values({
        shopId,
        orderId: order?.id ?? '',
        variantId: variant.id,
        quantity: 1,
        unitPrice: '3500',
      });
    });

    expect(await catalog.removeProduct(shopId, product.id)).toEqual({ removed: 'archived' });
    expect(unpublished).toEqual([]);

    const [archived] = await catalog.listProducts(shopId);
    expect(archived?.active).toBe(false);
    expect(await catalog.search(shopId, 'Nike', 5)).toEqual([]);
    expect(await catalog.variantForSale(shopId, variant.id)).toBeUndefined();
    expect(await catalog.openPost(postId)).toBeUndefined();
    await expect(catalog.postToChannel(shopId, product.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const items = await withShop(db, shopId, (tx) => tx.select().from(orderItems));
    expect(items).toHaveLength(1);

    expect((await catalog.restoreProduct(shopId, product.id)).active).toBe(true);
    expect((await catalog.search(shopId, 'Nike', 5)).map((p) => p.id)).toEqual([product.id]);
    expect(await catalog.openPost(postId)).toMatchObject({ product: { id: product.id } });
  });

  it('cannot remove or restore a product it does not have', async () => {
    const { catalog, shopId } = await shopWithChannel(9111);
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(catalog.removeProduct(shopId, missing)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(catalog.restoreProduct(shopId, missing)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
