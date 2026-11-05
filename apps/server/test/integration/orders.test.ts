import { productInputSchema } from '@buchi/shared';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { orderEvents, productVariants } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus, type DomainEvents } from '../../src/shared/events';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const noTelegram = {
  verifyPostingRights: () => Promise.reject(new Error('unused')),
  publish: () => Promise.reject(new Error('unused')),
};
const shops = new ShopsService(db, new ShopsRepo(db), noTelegram);
const catalog = new CatalogService(db, new CatalogRepo(), shops, noTelegram, 'bot');
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const bus = new EventBus(pino({ level: 'silent' }));
const published: DomainEvents['order.transitioned'][] = [];
bus.subscribe('order.transitioned', (event) => {
  published.push(event);
  return Promise.resolve();
});
const orders = new OrderService(db, new OrdersRepo(), bus);

let shopId = '';
let customerId = '';
const deadline = new Date(Date.now() + 3 * 3600_000);

async function variantWithStock(stock: number, pricingMode: 'fixed' | 'negotiable' = 'fixed') {
  const product = await catalog.createProduct(
    shopId,
    productInputSchema.parse(
      pricingMode === 'fixed'
        ? { title: 'Nike Air', pricingMode, price: '1500.50' }
        : { title: 'Samba', pricingMode, price: '2000', lowestPrice: '1800' },
    ),
  );
  await catalog.setVariants(shopId, product.id, [{ size: '42', color: null, stock }]);
  const [variant] =
    (await catalog.listProducts(shopId)).find((p) => p.id === product.id)?.variants ?? [];
  if (!variant) throw new Error('Variant missing');
  return variant.id;
}

const stockOf = (variantId: string) =>
  withShop(db, shopId, async (tx) => {
    const [row] = await tx
      .select({ stock: productVariants.stock, reserved: productVariants.reserved })
      .from(productVariants)
      .where(eq(productVariants.id, variantId));
    return row;
  });

const order = (variantId: string, quantity = 1) =>
  orders.create(
    shopId,
    {
      customerId,
      items: [{ variantId, quantity }],
      deliveryType: 'pickup',
      paymentDeadline: deadline,
    },
    'customer',
  );

beforeAll(async () => {
  shopId = await shops.create(7001, { name: 'Order test shop' });
  customerId = (await customers.identify(shopId, 7002, 'Abebe')).id;
});

describe('OrderService', () => {
  it('reserves stock, totals the items, and records the creation', async () => {
    const variantId = await variantWithStock(3);
    const created = await order(variantId, 2);

    expect(created).toMatchObject({
      status: 'awaiting_payment',
      itemsTotal: '3001.00',
      total: '3001.00',
    });
    expect(await stockOf(variantId)).toEqual({ stock: 3, reserved: 2 });
    const history = await withShop(db, shopId, (tx) =>
      tx.select().from(orderEvents).where(eq(orderEvents.orderId, created.id)),
    );
    expect(history).toMatchObject([
      { fromStatus: null, toStatus: 'awaiting_payment', actor: 'customer' },
    ]);
  });

  it('sells the last unit once when two customers order it at the same time', async () => {
    const variantId = await variantWithStock(1);
    const results = await Promise.allSettled([order(variantId), order(variantId)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'CONFLICT' },
    });
    expect(await stockOf(variantId)).toEqual({ stock: 1, reserved: 1 });
  });

  it('releases the reservation when an unpaid order expires', async () => {
    const variantId = await variantWithStock(2);
    const created = await order(variantId);

    await orders.transition(shopId, created.id, 'expired', 'system', 'Payment deadline passed');

    expect(await stockOf(variantId)).toEqual({ stock: 2, reserved: 0 });
    expect(published.at(-1)).toEqual({
      shopId,
      orderId: created.id,
      from: 'awaiting_payment',
      to: 'expired',
    });
  });

  it('turns the reservation into a sale when the payment is approved', async () => {
    const variantId = await variantWithStock(2);
    const created = await order(variantId);

    await orders.transition(shopId, created.id, 'payment_submitted', 'customer', 'Screenshot sent');
    await orders.transition(shopId, created.id, 'payment_approved', 'system', 'Rules passed');

    expect(await stockOf(variantId)).toEqual({ stock: 1, reserved: 0 });
  });

  it('refuses a move that the state machine forbids, and changes nothing', async () => {
    const variantId = await variantWithStock(1);
    const created = await order(variantId);

    await expect(
      orders.transition(shopId, created.id, 'delivered', 'owner', 'Skipping ahead'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await orders.get(shopId, created.id)).status).toBe('awaiting_payment');
  });

  it('does not take a negotiable product without an agreed price', async () => {
    const variantId = await variantWithStock(1, 'negotiable');
    await expect(order(variantId)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await stockOf(variantId)).toEqual({ stock: 1, reserved: 0 });
  });
});
