import { productInputSchema } from '@buchi/shared';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { PaymentRefsRepo } from '../../src/modules/payments/payment-refs.repo';
import { RiskSignalsRepo } from '../../src/modules/payments/risk-signals.repo';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { testDatabaseUrl } from './test-database';
import { noEmbeddings } from '../fakes/no-embeddings';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const noChannels = {
  verifyPostingRights: () => Promise.reject(new Error('unused')),
  publish: () => Promise.reject(new Error('unused')),
};
const logger = pino({ level: 'silent' });
const shops = new ShopsService(db, new ShopsRepo(db), noChannels);
const catalog = new CatalogService(db, new CatalogRepo(), shops, noChannels, 'bot', noEmbeddings);
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const orders = new OrderService(
  db,
  new OrdersRepo(),
  new EventBus(logger),
  new TimerService(new TimersRepo(db), logger),
  new NegotiationService(db, new NegotiationsRepo()),
);
const refs = new PaymentRefsRepo(db);
const signals = new RiskSignalsRepo(db);

const shopIds: string[] = [];

/** A new order in the shop, for a new customer. */
async function newOrder(shopId: string): Promise<string> {
  const product = await catalog.createProduct(
    shopId,
    productInputSchema.parse({ title: 'Sneakers', pricingMode: 'fixed', price: '900' }),
  );
  await catalog.setVariants(shopId, product.id, [{ size: '41', color: null, stock: 1 }]);
  const variant = (await catalog.listProducts(shopId)).find((p) => p.id === product.id)
    ?.variants[0];
  const customer = await customers.identify(shopId, Math.floor(Math.random() * 1e9), 'Buyer');
  const created = await orders.create(
    shopId,
    {
      customerId: customer.id,
      items: [{ variantId: variant?.id ?? '', quantity: 1 }],
      delivery: { type: 'pickup' },
      paymentDeadline: new Date(Date.now() + 3_600_000),
    },
    'customer',
  );
  return created.id;
}

beforeAll(async () => {
  shopIds.push(
    await shops.create(880701, { name: 'Refs Shop A' }),
    await shops.create(880702, { name: 'Refs Shop B' }),
  );
});

describe('payment reference claims (R6)', () => {
  it('lets exactly one of two shops claim the same reference at the same time', async () => {
    const [shopA = '', shopB = ''] = shopIds;
    for (let round = 0; round < 5; round += 1) {
      const orderIds = [await newOrder(shopA), await newOrder(shopB)];
      const txRef = `PAR${String(round).padStart(7, '0')}`;

      const holders = await Promise.all(
        orderIds.map((orderId) => refs.claim('telebirr', txRef, orderId)),
      );

      expect(holders[0]).toBe(holders[1]);
      expect(orderIds).toContain(holders[0]);
    }
  });

  it('gives a resend for the same order the same claim', async () => {
    const orderId = await newOrder(shopIds[0] ?? '');
    expect(await refs.claim('cbe_bank', 'FT26189X24XP', orderId)).toBe(orderId);
    expect(await refs.claim('cbe_bank', 'FT26189X24XP', orderId)).toBe(orderId);
  });

  it('keeps one reference per provider apart from the same text at another provider', async () => {
    const [first, second] = [await newOrder(shopIds[0] ?? ''), await newOrder(shopIds[1] ?? '')];
    expect(await refs.claim('telebirr', 'SAME000001', first)).toBe(first);
    expect(await refs.claim('cbe_birr', 'SAME000001', second)).toBe(second);
  });

  it('frees a reference only for the order that holds it', async () => {
    const [holder, other] = [await newOrder(shopIds[0] ?? ''), await newOrder(shopIds[1] ?? '')];
    await refs.claim('telebirr', 'FREE000001', holder);
    await refs.release('telebirr', 'FREE000001', other);
    expect(await refs.claim('telebirr', 'FREE000001', other)).toBe(holder);

    await refs.release('telebirr', 'FREE000001', holder);
    expect(await refs.claim('telebirr', 'FREE000001', other)).toBe(other);
  });
});

describe('risk signals', () => {
  it('counts the shops that recorded a signal for any of the payer hashes', async () => {
    const [shopA = '', shopB = ''] = shopIds;
    await signals.insert(shopA, 'receipt_rejected', ['hash-phone', 'hash-telegram']);
    await signals.insert(shopA, 'owner_rejected', ['hash-telegram']);
    expect(await signals.shopCount(['hash-telegram'])).toBe(1);

    await signals.insert(shopB, 'bank_mismatch', ['hash-phone']);
    expect(await signals.shopCount(['hash-telegram', 'hash-phone'])).toBe(2);
    expect(await signals.shopCount(['hash-unknown'])).toBe(0);
  });
});
