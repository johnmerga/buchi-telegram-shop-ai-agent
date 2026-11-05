/**
 * Creates the demo shop "Selam Shoes" with products, owned by the Telegram user ID given as the
 * first argument. Connect the channel and add photos afterwards, from the dashboard and the bot.
 *
 *   pnpm --filter @buchi/server seed:demo 123456789
 */
import { productInputSchema, variantsInputSchema } from '@buchi/shared';
import { pino } from 'pino';
import { z } from 'zod';
import { loadDatabaseUrl } from '../src/config/env';
import { connectDatabase } from '../src/db/client';
import { CatalogRepo } from '../src/modules/catalog/catalog.repo';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { ProductEmbeddingService } from '../src/modules/catalog/product-embeddings.service';
import { TimersRepo } from '../src/modules/jobs/timers.repo';
import { ShopsRepo } from '../src/modules/shops/shops.repo';
import { ShopsService } from '../src/modules/shops/shops.service';

const products = [
  {
    product: {
      title: 'Nike Air Force 1',
      description: 'ነጭ / White, original',
      pricingMode: 'fixed',
      price: '4500',
    },
    variants: ['40', '41', '42', '43'].map((size) => ({ size, stock: 3 })),
  },
  {
    product: {
      title: 'Adidas Samba',
      description: 'ጥቁር / Black',
      pricingMode: 'negotiable',
      price: '5200',
      lowestPrice: '4700',
    },
    variants: ['39', '40', '41'].map((size) => ({ size, stock: 2 })),
  },
  {
    product: {
      title: 'Leather loafers',
      description: 'ቡናማ / Brown, handmade in Addis',
      pricingMode: 'negotiable',
      price: '3800',
      lowestPrice: '3300',
    },
    variants: ['41', '42', '44'].map((size) => ({ size, stock: 1 })),
  },
];

const ownerId = z.coerce.number().int().positive().parse(process.argv[2]);
const { db, close } = connectDatabase(loadDatabaseUrl(process.env));
const noTelegram = {
  verifyPostingRights: () => Promise.reject(new Error('The seed does not use Telegram')),
  publish: () => Promise.reject(new Error('The seed does not use Telegram')),
};
const shops = new ShopsService(db, new ShopsRepo(db), noTelegram);
// The seed only schedules the embeddings. The running server's timer tick computes them.
const embeddings = new ProductEmbeddingService(
  db,
  new CatalogRepo(),
  { embed: () => Promise.reject(new Error('The seed does not embed')) },
  new TimersRepo(db),
  () => new Date(),
  pino({ level: 'silent' }),
);
const catalog = new CatalogService(db, new CatalogRepo(), shops, noTelegram, 'unused', embeddings);

try {
  const shopId = await shops.create(ownerId, { name: 'Selam Shoes' });
  await shops.setLocation(shopId, { latitude: 8.9956, longitude: 38.7867 });
  await shops.setPaymentAccounts(shopId, [
    { provider: 'telebirr', accountName: 'Selam Tesfaye', accountNumber: '0911234567' },
    { provider: 'cbe_bank', accountName: 'Selam Tesfaye', accountNumber: '1000123456789' },
  ]);
  for (const item of products) {
    const product = await catalog.createProduct(shopId, productInputSchema.parse(item.product));
    await catalog.setVariants(shopId, product.id, variantsInputSchema.parse(item.variants));
  }
  console.log(`Created Selam Shoes (${shopId}) for Telegram user ${String(ownerId)}`);
} finally {
  await close();
}
