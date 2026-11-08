import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import {
  agentDecisions,
  conversations,
  customerSessions,
  customers,
  deliveryJobs,
  drivers,
  farQuotes,
  orderItems,
  orders,
  paymentRefs,
  products,
  relayedMessages,
  riskSignals,
  timers,
  waitlist,
} from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { AreaNotesRepo } from '../../src/modules/delivery/area-notes.repo';
import { AreaNoteService } from '../../src/modules/delivery/area-notes.service';
import { DeliverySettingsRepo } from '../../src/modules/delivery/delivery-settings.repo';
import { DeliveryService } from '../../src/modules/delivery/delivery.service';
import type { SyntheticLeg } from '../../src/modules/delivery/factors.domain';
import { DemoRepo } from '../../src/modules/demo/demo.repo';
import { DemoReset } from '../../src/modules/demo/demo-reset.service';
import { DemoScenariosRepo } from '../../src/modules/demo/demo-scenarios.repo';
import { DemoScenarios } from '../../src/modules/demo/demo-scenarios.service';
import { DemoSeeder } from '../../src/modules/demo/demo-seed.service';
import { DELIVERY_LATE_TIMER } from '../../src/modules/drivers/trips.service';
import { AcceptanceFactorService } from '../../src/modules/far-quotes/acceptance-factors.service';
import { FarQuotesRepo } from '../../src/modules/far-quotes/far-quotes.repo';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { DEMO_TELEGRAM_ID_BASE } from '../../src/shared/demo-ids';
import { noEmbeddings } from '../fakes/no-embeddings';
import { noEvents } from '../fakes/no-events';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const now = new Date();
const clock = () => now;
const unused = () => Promise.reject(new Error('unused'));
const shops = new ShopsService(db, new ShopsRepo(db), { verifyPostingRights: unused });
const delivery = new DeliveryService(
  db,
  new DeliverySettingsRepo(),
  shops,
  { between: unused },
  unused,
  { deliveryPaused: unused },
);
const catalog = new CatalogService(
  db,
  new CatalogRepo(),
  shops,
  { publish: unused },
  'buchi_test_bot',
  noEmbeddings,
  noEvents,
);

// Road legs and time factors are platform-wide, so these tests keep them away from other tests.
const legs: SyntheticLeg[] = [];
const zoneFactors = {
  addSyntheticLegs: (added: SyntheticLeg[]) => Promise.resolve(void legs.push(...added)),
  removeSyntheticLegs: () => Promise.resolve(void legs.splice(0)),
  learn: () =>
    Promise.resolve({ legs: 0, zones: 0, estimateErrorPercent: 0, learnedErrorPercent: 0 }),
};
const realAcceptance = new AcceptanceFactorService(db, new FarQuotesRepo(), clock);
const acceptance = {
  addSynthetic: realAcceptance.addSynthetic.bind(realAcceptance),
  learnAll: () => Promise.resolve({ shops: 0, acceptanceZones: 0 }),
};
const reset = new DemoReset(db, new DemoRepo(), zoneFactors, acceptance);
const seeder = new DemoSeeder(
  db,
  new DemoRepo(),
  shops,
  delivery,
  catalog,
  zoneFactors,
  acceptance,
  new AreaNoteService(db, new AreaNotesRepo(), clock),
  reset,
  clock,
);
const scheduled: { kind: string; targetId: string; dueAt: Date }[] = [];
const scenarios = new DemoScenarios(
  db,
  new DemoScenariosRepo(),
  shops,
  delivery,
  {
    schedule: (_tx, kind, targetId, _shopId, dueAt) =>
      Promise.resolve(void scheduled.push({ kind, targetId, dueAt })),
  },
  clock,
);

const photos = [
  { photo: 'a.jpg', brand: 'Football shoes', itemCode: 'M1910' },
  { photo: 'b.jpg', brand: 'Nike', color: 'grey' },
  { photo: 'c.jpg', brand: 'Puma', color: 'white' },
  { photo: 'd.jpg', brand: 'ASICS', color: 'teal' },
];
const realCustomer = 980_001;
const realDriver = 980_002;
let shopId = '';
let realProductId = '';

const demoCustomers = (id: string) =>
  withShop(db, id, (tx) =>
    tx.select().from(customers).where(gte(customers.telegramUserId, DEMO_TELEGRAM_ID_BASE)),
  );

beforeAll(async () => {
  shopId = await shops.create(980_000, { name: 'Demo Shoes' });
  await shops.setLocation(shopId, { latitude: 8.98, longitude: 38.75 });
  realProductId = (
    await catalog.createListing(shopId, {
      product: { title: 'Owner boot', description: '', pricingMode: 'fixed', price: '2000.00' },
      variants: [{ size: '42', color: null, stock: 3 }],
      photoFileIds: [],
    })
  ).id;
  await withShop(db, shopId, async (tx) => {
    await tx.insert(customers).values({ shopId, telegramUserId: realCustomer, name: 'Johannes' });
    await tx.insert(drivers).values({
      shopId,
      username: 'real_driver',
      telegramUserId: realDriver,
      name: 'Real driver',
      available: true,
      linkedAt: now,
    });
  });
});

describe('the demo seed', () => {
  it('fills the shop with demo history, and gives the same shop when run again', async () => {
    const first = await seeder.seed(shopId, photos);
    const second = await seeder.seed(shopId, photos);
    expect(second.removed).toMatchObject({ customers: 40, orders: 120, productsDeleted: 4 });
    expect({ ...second, removed: first.removed }).toEqual(first);
    expect(await demoCustomers(shopId)).toHaveLength(40);
    const shopOrders = await withShop(db, shopId, (tx) => tx.select().from(orders));
    expect(shopOrders).toHaveLength(120);
    expect(shopOrders.every((order) => Number(order.total) > 0)).toBe(true);
    const far = await withShop(db, shopId, (tx) => tx.select().from(farQuotes));
    expect(far.length).toBe(first.farTrips);
    expect(legs.length).toBeGreaterThan(first.trips);
    expect(first.waitlist).not.toBeNull();
  });

  it('gives the real driver a share of the demo trips', async () => {
    const [driver] = await withShop(db, shopId, (tx) =>
      tx.select().from(drivers).where(eq(drivers.telegramUserId, realDriver)),
    );
    const trips = await withShop(db, shopId, (tx) =>
      tx
        .select()
        .from(deliveryJobs)
        .where(eq(deliveryJobs.driverId, driver?.id ?? '')),
    );
    expect(trips.length).toBeGreaterThan(0);
  });
});

describe('the demo scenarios', () => {
  it('puts a late trip on the road with its late check due now', async () => {
    const trip = await scenarios.onTheRoad(
      shopId,
      { customer: realCustomer, driver: realDriver },
      true,
    );
    const timer = scheduled.at(-1);
    expect(timer?.kind).toBe(DELIVERY_LATE_TIMER);
    expect(timer?.dueAt.getTime()).toBeLessThanOrEqual(now.getTime());
    const [job] = await withShop(db, shopId, (tx) =>
      tx
        .select()
        .from(deliveryJobs)
        .where(eq(deliveryJobs.id, timer?.targetId ?? '')),
    );
    expect(job?.status).toBe('picked_up');
    expect(trip.order).toMatch(/^#[0-9A-F]{6}$/);
    // The driver gets what a real pickup sends, so Delivered is a tap away.
    const [live, stop] = trip.driverMessages;
    expect(live?.text).toContain('Live Location');
    expect(stop?.buttons.map((button) => button.data)).toEqual([
      expect.stringMatching(/^job:delivered:/),
      `job:problem:${job?.id ?? ''}`,
    ]);
  });

  it('keeps the late check ahead for a trip that is on time', async () => {
    const trip = await scenarios.onTheRoad(
      shopId,
      { customer: realCustomer, driver: realDriver },
      false,
    );
    expect(trip.lateCheckAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('refuses a driver who is not linked to the shop', async () => {
    await expect(
      scenarios.onTheRoad(shopId, { customer: realCustomer, driver: 1 }, true),
    ).rejects.toThrow('not a linked driver');
  });

  it('puts the real customer first in line for the sold-out size', async () => {
    const waited = await scenarios.restockWaitlist(shopId, realCustomer);
    const line = await withShop(db, shopId, (tx) =>
      tx
        .select({ telegramUserId: customers.telegramUserId })
        .from(waitlist)
        .innerJoin(customers, eq(customers.id, waitlist.customerId))
        .orderBy(waitlist.joinedAt),
    );
    expect(line[0]?.telegramUserId).toBe(realCustomer);
    expect(line.length).toBeGreaterThan(1);
    expect(waited.size).toBeTruthy();
  });

  it('finds a far spot above the cap', async () => {
    const spot = await scenarios.farOverCap(shopId);
    expect(Number(spot.payout)).toBeGreaterThan(Number(spot.cap));
  });
});

describe('the demo reset', () => {
  it('removes only demo rows, and retires a demo product that a real order names', async () => {
    const [demoVariant] = await withShop(db, shopId, (tx) =>
      tx
        .select({ id: orderItems.variantId })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(eq(customers.telegramUserId, realCustomer))
        .limit(1),
    );
    expect(demoVariant).toBeDefined();

    const removed = await reset.reset(shopId);
    expect(removed).toMatchObject({ customers: 40, orders: 120, drivers: 4 });
    expect(removed.productsRetired).toBeGreaterThan(0);
    expect(await demoCustomers(shopId)).toHaveLength(0);
    expect(legs).toHaveLength(0);
    await withShop(db, shopId, async (tx) => {
      const people = await tx
        .select({ id: customers.telegramUserId })
        .from(customers)
        .where(lt(customers.telegramUserId, DEMO_TELEGRAM_ID_BASE));
      expect(people.map((person) => person.id)).toEqual([realCustomer]);
      const realOrders = await tx.select().from(orders);
      expect(realOrders).toHaveLength(2);
      const [owned] = await tx.select().from(products).where(eq(products.id, realProductId));
      expect(owned?.active).toBe(true);
      const left = await tx
        .select()
        .from(products)
        .where(and(eq(products.synthetic, true), eq(products.active, true)));
      expect(left).toHaveLength(0);
      expect(await tx.select().from(farQuotes)).toHaveLength(0);
      expect(await tx.select().from(drivers)).toHaveLength(1);
    });
  });
});

describe('deleting a shop', () => {
  /** Rows per table that name the shop, for every table with a `shop_id` column. */
  async function rowsOf(id: string): Promise<Record<string, number>> {
    const tables = await db.execute<{ table_name: string }>(sql`
      select c.table_name from information_schema.columns c
      join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and c.column_name = 'shop_id' and t.table_type = 'BASE TABLE'
      order by c.table_name`);
    const counts: Record<string, number> = {};
    for (const { table_name: table } of tables) {
      const [row] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where shop_id = ${id}`,
      );
      counts[table] = row?.n ?? 0;
    }
    return counts;
  }

  it('removes every row of the shop, and only that shop, under row-level security', async () => {
    const goneId = await shops.create(980_100, { name: 'Shop to delete' });
    await shops.setLocation(goneId, { latitude: 8.98, longitude: 38.75 });
    await seeder.seed(goneId, photos);
    await withShop(db, goneId, async (tx) => {
      const [decision] = await tx
        .insert(agentDecisions)
        .values({
          shopId: goneId,
          runId: crypto.randomUUID(),
          agent: 'operations',
          tool: 'propose_delivery_price',
          proposed: { price: '500.00' },
          result: 'needs_owner',
          reason: 'Above the cap',
          ownerStatus: 'pending',
        })
        .returning();
      const [quote] = await tx.select().from(farQuotes).limit(1);
      await tx
        .update(farQuotes)
        .set({ decisionId: decision?.id ?? null })
        .where(eq(farQuotes.id, quote?.id ?? ''));
      const [chat] = await tx
        .insert(conversations)
        .values({ shopId: goneId, customerTelegramUserId: 980_101, customerName: 'Abebe' })
        .returning();
      await tx.insert(relayedMessages).values({
        ownerChatId: 980_100,
        messageId: 1,
        shopId: goneId,
        conversationId: chat?.id ?? '',
      });
    });
    await db.insert(timers).values({
      kind: 'test',
      targetId: 'x',
      shopId: goneId,
      dueAt: new Date(now.getTime() + 60_000),
    });
    await db.insert(customerSessions).values({ telegramUserId: 980_101, shopId: goneId });
    await db
      .insert(riskSignals)
      .values({ payerHash: 'h', shopId: goneId, kind: 'receipt_rejected' });
    const goneOrders = (
      await withShop(db, goneId, (tx) => tx.select({ id: orders.id }).from(orders))
    ).map((order) => order.id);
    const refsBefore = await db
      .select()
      .from(paymentRefs)
      .where(inArray(paymentRefs.orderId, goneOrders));
    expect(refsBefore.length).toBeGreaterThan(0);
    const before = await rowsOf(goneId);
    expect(before.orders).toBeGreaterThan(0);
    expect(before.agent_decisions).toBeGreaterThan(0);
    const otherBefore = await rowsOf(shopId);

    await expect(shops.delete(goneId, 'Shop to remove')).rejects.toThrow(
      "Type the shop's name, Shop to delete, to delete it",
    );
    await shops.delete(goneId, ' Shop to delete ');

    const after = await rowsOf(goneId);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect(
      await db.select().from(paymentRefs).where(inArray(paymentRefs.orderId, goneOrders)),
    ).toHaveLength(0);
    expect(await shops.ownedShopIds(980_100)).toEqual([]);
    expect(await rowsOf(shopId)).toEqual(otherBefore);
  });
});
