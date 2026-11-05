import { productInputSchema, type ProductInput } from '@buchi/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { productVariants } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService, type ChannelPublisher } from '../../src/modules/catalog/catalog.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService, type ChannelVerifier } from '../../src/modules/shops/shops.service';
import { testDatabaseUrl } from './test-database';

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
  const catalog = new CatalogService(
    db,
    new CatalogRepo(),
    { channelChatId: async (shopId) => (await shops.get(shopId)).channelChatId },
    {
      publish: (post) => {
        published.push(post);
        return publish(post);
      },
    },
    'buchi_test_bot',
  );
  return { shops, catalog, published };
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
});
