import { Money, productInputSchema } from '@buchi/shared';
import { eq, sql } from 'drizzle-orm';
import { cellToChildren } from 'h3-js';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import {
  customers as customersTable,
  orders as ordersTable,
  telegramUpdates,
} from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { ZoneFactorsRepo } from '../../src/modules/delivery/zone-factors.repo';
import { ZoneFactorService } from '../../src/modules/delivery/zone-factors.service';
import { parentZone, zoneCenter, zoneOf } from '../../src/modules/delivery/zones.domain';
import { AcceptanceFactorService } from '../../src/modules/far-quotes/acceptance-factors.service';
import { FarQuotesRepo } from '../../src/modules/far-quotes/far-quotes.repo';
import { NightlyLearningService } from '../../src/modules/jobs/nightly-learning.service';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { TelegramUpdatesRepo } from '../../src/telegram/updates.repo';
import { noEmbeddings } from '../fakes/no-embeddings';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const logger = pino({ level: 'silent' });
/** 09:00 in Addis Ababa, at rush hour, a fixed time so the bands do not depend on the clock. */
const now = new Date('2026-11-05T06:00:00Z');
const clock = () => now;
const DAY_MS = 24 * 60 * 60_000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

const shops = new ShopsService(db, new ShopsRepo(db), {
  verifyPostingRights: () => Promise.reject(new Error('unused')),
});
const catalog = new CatalogService(
  db,
  new CatalogRepo(),
  shops,
  { publish: () => Promise.reject(new Error('unused')) },
  'buchi_test_bot',
  noEmbeddings,
);
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const orders = new OrderService(
  db,
  new OrdersRepo(),
  new EventBus(logger),
  new TimerService(new TimersRepo(db), logger),
  new NegotiationService(db, new NegotiationsRepo()),
);
const zoneFactors = new ZoneFactorService(new ZoneFactorsRepo(db), clock);
const acceptance = new AcceptanceFactorService(db, new FarQuotesRepo(), clock);
const updates = new TelegramUpdatesRepo(db);
const nightly = new NightlyLearningService(
  zoneFactors,
  acceptance,
  orders,
  customers,
  updates,
  logger,
  clock,
);

/** A rush-hour leg 30 minutes long by routing, which took `ratio` times as long. */
const leg = (zone: string, ratio: number, days: number) => ({
  zone,
  startedAt: new Date(daysAgo(days).getTime() - 60 * 60_000),
  routingSeconds: 1800,
  actualSeconds: Math.round(1800 * ratio),
});

// Learning zones far from the other tests' pins, so their factors stay their own.
const learned = { latitude: 9.15, longitude: 38.9 };
const learnedZone = zoneOf(learned);
const sibling = cellToChildren(parentZone(learnedZone), 7).find((zone) => zone !== learnedZone);

let shopId = '';

beforeAll(async () => {
  shopId = await shops.create(770001, { name: 'Learning Shoes' });
  await zoneFactors.addSyntheticLegs([
    leg(learnedZone, 2, 1),
    leg(learnedZone, 2, 2),
    leg(learnedZone, 1.8, 3),
    leg(learnedZone, 2.2, 4),
  ]);
  await zoneFactors.recordLeg({
    destination: learned,
    startedAt: new Date(daysAgo(1).getTime() - 60 * 60_000),
    routingSeconds: 1800,
    expectedSeconds: 1800,
    actualSeconds: 3600,
  });
});

describe('the nightly learning', () => {
  it('learns time factors from trip legs and measures the last two weeks', async () => {
    const summary = await nightly.run();
    // The one real leg took twice its estimate of 30 minutes, an error of 50%.
    expect(summary.estimateErrorPercent).toBe(50);
    expect(summary.learnedErrorPercent).toBeLessThan(50);
    expect(summary.zones).toBeGreaterThanOrEqual(3);
    expect(await zoneFactors.timeFactor(learned)).toBeGreaterThan(1.3);
  });

  it("gives a zone with no trips its parent's factor", async () => {
    if (!sibling) throw new Error('The parent zone has no sibling');
    const detail = await zoneFactors.timeFactorDetail(zoneCenter(sibling));
    expect(detail).toMatchObject({ from: parentZone(learnedZone), band: 'peak' });
    expect(detail.factor).toBeLessThan(await zoneFactors.timeFactor(learned));
    expect(detail.factor).toBeGreaterThan(1);
  });

  it("learns each shop's acceptance factor for the larger zone of its far trips", async () => {
    const trip = (id: string, held: string, days: number) => ({
      id,
      zone: learnedZone,
      routeMeters: 15_000,
      routingSeconds: 1800,
      formulaPayout: '300.00',
      cap: '1000.00',
      firstPrice: '300.00',
      heldPrice: held,
      raises: 0,
      at: daysAgo(days),
    });
    await acceptance.addSynthetic(shopId, [
      trip('00000000-0000-4000-8000-0000000000f1', '450.00', 3),
      trip('00000000-0000-4000-8000-0000000000f2', '420.00', 10),
      trip('00000000-0000-4000-8000-0000000000f3', '480.00', 20),
    ]);

    await nightly.run();

    const lookup = await acceptance.lookup(shopId, learnedZone);
    expect(lookup).toMatchObject({ from: parentZone(learnedZone), trips: 3 });
    expect(lookup.factor).toBeGreaterThan(1.1);
    expect(lookup.factor).toBeLessThan(1.5);
    const elsewhere = await acceptance.lookup(shopId, zoneOf({ latitude: 8.9, longitude: 38.7 }));
    expect(elsewhere.from).toBe('shop');
  });
});

describe('forgetting exact locations', () => {
  const pin = { latitude: 8.99, longitude: 38.79 };

  async function deliveredOrder(customerId: string, variantId: string): Promise<string> {
    const order = await orders.create(
      shopId,
      {
        customerId,
        items: [{ variantId, quantity: 1 }],
        delivery: { type: 'express', fee: Money.of('100'), destination: pin },
        paymentDeadline: new Date(Date.now() + 60 * 60_000),
      },
      'customer',
    );
    await orders.transitionIfStill(
      shopId,
      order.id,
      'awaiting_payment',
      'cancelled',
      'customer',
      'No',
    );
    return order.id;
  }

  it('deletes pins older than a week from ended orders, pending checkouts, and Telegram updates', async () => {
    const product = await catalog.createProduct(
      shopId,
      productInputSchema.parse({ title: 'Boots', pricingMode: 'fixed', price: '900' }),
    );
    await catalog.setVariants(shopId, product.id, [{ size: '40', color: null, stock: 5 }]);
    const variantId = (await catalog.listProducts(shopId))[0]?.variants[0]?.id ?? '';
    const old = await customers.identify(shopId, 770101, 'Old');
    const recent = await customers.identify(shopId, 770102, 'Recent');
    const oldOrder = await deliveredOrder(old.id, variantId);
    const recentOrder = await deliveredOrder(recent.id, variantId);
    await customers.setDeliveryPin(shopId, old.id, pin);
    await customers.setDeliveryPin(shopId, recent.id, pin);
    // The nightly job runs eight days later for the old rows, by moving them back in time.
    await db.execute(
      sql`update orders set updated_at = ${daysAgo(8).toISOString()}::timestamptz where id = ${oldOrder}`,
    );
    await db.execute(
      sql`update customers set delivery_pin_at = ${daysAgo(8).toISOString()}::timestamptz where id = ${old.id}`,
    );
    await db.insert(telegramUpdates).values([
      {
        updateId: 7_700_001,
        payload: { update_id: 7_700_001 },
        status: 'done',
        receivedAt: daysAgo(8),
      },
      {
        updateId: 7_700_002,
        payload: { update_id: 7_700_002 },
        status: 'pending',
        receivedAt: daysAgo(8),
      },
    ]);

    const summary = await nightly.run();

    expect(summary).toMatchObject({ orderPinsForgotten: 1, pendingPinsForgotten: 1 });
    expect(summary.updatesDeleted).toBeGreaterThanOrEqual(1);
    const rows = await withShop(db, shopId, (tx) => tx.select().from(ordersTable));
    expect(rows.find((o) => o.id === oldOrder)).toMatchObject({
      deliveryLatitude: null,
      deliveryLongitude: null,
      deliveryZone: zoneOf(pin),
    });
    expect(rows.find((o) => o.id === recentOrder)?.deliveryLatitude).toBe(pin.latitude);
    const pins = await withShop(db, shopId, (tx) =>
      tx
        .select({ id: customersTable.id, latitude: customersTable.deliveryLatitude })
        .from(customersTable),
    );
    expect(pins.find((c) => c.id === old.id)?.latitude).toBeNull();
    expect(pins.find((c) => c.id === recent.id)?.latitude).toBe(pin.latitude);
    const left = await db
      .select({ id: telegramUpdates.updateId })
      .from(telegramUpdates)
      .where(eq(telegramUpdates.updateId, 7_700_002));
    expect(left).toHaveLength(1);
  });
});
