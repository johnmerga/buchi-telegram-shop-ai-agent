import { insightsSchema, ledgerSettingsSchema, productInputSchema } from '@buchi/shared';
import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import {
  agentDecisions,
  channelPosts,
  customers as customersTable,
  deliveryJobs,
  demandSignals,
  drivers,
  ledgerRows,
  orderEvents,
  orders as ordersTable,
  paymentProofs,
  waitlist,
} from '../../src/db/schema';
import { createApp } from '../../src/http/app';
import { requireAuth } from '../../src/http/middleware/require-auth';
import { requireShopOwner } from '../../src/http/middleware/require-shop-owner';
import { AuthService } from '../../src/modules/auth/auth.service';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { DailyReportsRepo } from '../../src/modules/reports/daily-reports.repo';
import { DailyReports } from '../../src/modules/reports/daily-reports.service';
import { InsightsRepo } from '../../src/modules/reports/insights.repo';
import { InsightsService } from '../../src/modules/reports/insights.service';
import { LedgerRepo } from '../../src/modules/reports/ledger.repo';
import { LedgerService } from '../../src/modules/reports/ledger.service';
import { createReportsRouter } from '../../src/modules/reports/reports.routes';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { noEmbeddings } from '../fakes/no-embeddings';
import { launchFields, signInitData } from '../sign-init-data';
import { testDatabaseUrl } from './test-database';
import { StockHoldsRepo } from '../../src/modules/orders/stock-holds.repo';
import { noEvents } from '../fakes/no-events';
import { noPromotions } from '../fakes/no-owner-rules';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

/** 6:00 PM in Addis Ababa on 5 November 2026, when the cron service calls the evening summary. */
const evening = new Date('2026-11-05T15:00:00Z');
const clock = () => evening;
const logger = pino({ level: 'silent' });

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
  noEvents,
);
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const orders = new OrderService(
  db,
  new OrdersRepo(),
  new EventBus(logger),
  new TimerService(new TimersRepo(db), logger),
  new NegotiationService(db, new NegotiationsRepo()),
  noPromotions,
  new StockHoldsRepo(),
);
const sent: { shopId: string; text: string }[] = [];
const ledger = new LedgerService(db, new LedgerRepo(), undefined, logger, clock);
const dailyRepo = new DailyReportsRepo();
const reports = new DailyReports(
  db,
  dailyRepo,
  {
    send: (shopId, text) => {
      sent.push({ shopId, text });
      return Promise.resolve();
    },
  },
  ledger,
  logger,
  clock,
);

const botToken = '123456:test-token';
const auth = new AuthService({ botToken, tokenSecret: 't'.repeat(32), now: () => new Date() });
const app = createApp({
  logger,
  routers: [
    createReportsRouter({
      insights: new InsightsService(db, new InsightsRepo(), dailyRepo, clock),
      ledger,
      reports,
      requireAuth: requireAuth((token) => auth.verifyToken(token)),
      requireShopOwner: requireShopOwner((id) => shops.ownedShopIds(id)),
    }),
  ],
});

async function bearer(telegramUserId: number): Promise<string> {
  const initData = signInitData(launchFields(telegramUserId, new Date()), botToken);
  return `Bearer ${(await auth.signInWithMiniApp(initData)).token}`;
}

const owner = 660001;
const stranger = 660002;
const spreadsheetId = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
let shopId = '';
let productId = '';
const sizes: Record<string, string> = {};

const sentTo = (id: string) => sent.filter((message) => message.shopId === id);

/** Places an order of size 43 and moves its timestamps to `at`, as if it happened then. */
async function orderAt(telegramUserId: number, at: string, paid: boolean): Promise<string> {
  const customer = await customers.identify(
    shopId,
    telegramUserId,
    `Customer ${String(telegramUserId)}`,
  );
  const order = await orders.create(
    shopId,
    {
      customerId: customer.id,
      items: [{ variantId: sizes['43'] ?? '', quantity: 1 }],
      delivery: { type: 'pickup' },
      paymentDeadline: new Date('2026-11-06T00:00:00Z'),
    },
    'customer',
  );
  await orders.transition(shopId, order.id, 'payment_submitted', 'customer', 'Screenshot');
  await orders.transition(
    shopId,
    order.id,
    paid ? 'payment_approved' : 'payment_unclear',
    'system',
    'Checked',
  );
  await db
    .update(ordersTable)
    .set({ createdAt: new Date(at) })
    .where(eq(ordersTable.id, order.id));
  await db
    .update(orderEvents)
    .set({ createdAt: new Date(at) })
    .where(eq(orderEvents.orderId, order.id));
  return order.id;
}

beforeAll(async () => {
  shopId = await shops.create(owner, { name: 'Selam Shoes' });
  const product = await catalog.createProduct(
    shopId,
    productInputSchema.parse({ title: 'Nike Air', pricingMode: 'fixed', price: '3500' }),
  );
  productId = product.id;
  await catalog.setVariants(shopId, product.id, [
    { size: '42', color: null, stock: 2 },
    { size: '43', color: null, stock: 10 },
  ]);
  for (const variant of (await catalog.listProducts(shopId))[0]?.variants ?? []) {
    sizes[variant.size] = variant.id;
  }
  await db.insert(channelPosts).values({
    shopId,
    productId,
    chatId: -1001,
    messageId: 7,
    taps: 5,
    createdAt: new Date('2026-11-01T08:00:00Z'),
  });

  // 00:01 on 5 November in Addis Ababa counts; 23:59 on the 4th does not.
  const paidToday = await orderAt(660101, '2026-11-04T21:01:00Z', true);
  await orderAt(660102, '2026-11-04T20:59:00Z', true);
  const inReview = await orderAt(660103, '2026-11-05T10:00:00Z', false);

  await db.insert(paymentProofs).values([
    {
      shopId,
      orderId: paidToday,
      telegramFileId: 'file-paid',
      amount: '3500.00',
      decision: 'approve',
      createdAt: new Date('2026-11-05T09:00:00Z'),
    },
    {
      shopId,
      orderId: inReview,
      telegramFileId: 'file-fake',
      amount: '3500.00',
      decision: 'reject',
      createdAt: new Date('2026-11-05T12:00:00Z'),
    },
  ]);
  const [driver] = await db
    .insert(drivers)
    .values({ shopId, username: 'abebe_rides' })
    .returning({ id: drivers.id });
  await db.insert(deliveryJobs).values({
    shopId,
    driverId: driver?.id,
    status: 'delivered',
    payout: '100.00',
    separateTripsPayout: '160.00',
    routeMeters: 6000,
    estimatedMinutes: 25,
    deliveredAt: new Date('2026-11-05T13:00:00Z'),
  });
  await db.insert(agentDecisions).values({
    shopId,
    runId: '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
    agent: 'operations',
    tool: 'propose_bonus',
    proposed: {},
    result: 'needs_owner',
    reason: 'owner_confirms',
    ownerStatus: 'pending',
  });
  const [waiting] = await db
    .select({ id: customersTable.id })
    .from(customersTable)
    .where(and(eq(customersTable.shopId, shopId), eq(customersTable.telegramUserId, 660101)));
  await db
    .insert(waitlist)
    .values({ shopId, customerId: waiting?.id ?? '', variantId: sizes['42'] ?? '' });
  await db.insert(demandSignals).values({
    shopId,
    customerId: waiting?.id ?? '',
    description: 'Red sandals',
    notifyRequested: true,
    createdAt: new Date('2026-11-03T10:00:00Z'),
  });
  await ledger.connect(shopId, spreadsheetId);
});

describe('evening summary job', () => {
  it('reports the Addis Ababa day to the owners and queues the day’s ledger row', async () => {
    const summary = await reports.eveningSummaries();
    expect(summary.failed).toBe(0);
    expect(sentTo(shopId).map((message) => message.text)).toEqual([
      [
        '🌇 የዕለቱ ማጠቃለያ / Evening summary · 2026-11-05',
        '🛒 ትዕዛዞች / Orders: 2 · ተከፍሏል / paid: 1',
        '💰 ገቢ / Revenue: 3,500.00 ብር',
        '🛵 የማድረሻ ወጪ / Delivery cost: 100.00 ብር',
        '💡 Saver ቁጠባ / Saver savings: 60.00 ብር',
        '🛡️ የታገዱ ማጭበርበሮች / Fraud blocked: 1 (3,500.00 ብር)',
        '⏳ ግምገማ የሚጠብቁ / Open reviews: 2',
      ].join('\n'),
    ]);
    const rows = await db.select().from(ledgerRows).where(eq(ledgerRows.shopId, shopId));
    expect(rows.map((row) => [row.key, row.cells])).toEqual([
      ['day-2026-11-05', ['day-2026-11-05', '2026-11-05', 2, 1, 3500, 100, 60, 1, 3500, 2]],
    ]);
  });

  it('sends nothing twice when the cron service calls again the same day', async () => {
    const summary = await reports.eveningSummaries();
    expect(summary.alreadySent).toBeGreaterThanOrEqual(1);
    expect(sentTo(shopId)).toHaveLength(1);
  });
});

describe('morning brief job', () => {
  it('lists low stock, open reviews, and waitlist demand', async () => {
    sent.length = 0;
    await reports.morningBriefs();
    const [brief] = sentTo(shopId);
    expect(brief?.text).toContain('• Nike Air · 42: 2 ቀርቷል / left');
    expect(brief?.text).not.toContain('Nike Air · 43:');
    expect(brief?.text).toContain('Open reviews: 2');
    expect(brief?.text).toContain('• Nike Air · 42: 1 ሰው / waiting');
    expect(brief?.text).toContain('Notify-me requests (7 days): 1');
  });
});

describe('Run now', () => {
  it('sends the shop’s own report at once, even after the cron sent it', async () => {
    sent.length = 0;
    const res = await request(app)
      .post(`/shops/${shopId}/reports/morning-brief`)
      .set('authorization', await bearer(owner));
    expect(res.status).toBe(204);
    expect(sentTo(shopId)[0]?.text).toContain('Morning brief');
    expect(sent.every((message) => message.shopId === shopId)).toBe(true);
  });

  it('runs only the daily reports, and only for the shop’s owners', async () => {
    const unknown = await request(app)
      .post(`/shops/${shopId}/reports/nightly-learning`)
      .set('authorization', await bearer(owner));
    expect(unknown.status).toBe(400);
    const blocked = await request(app)
      .post(`/shops/${shopId}/reports/evening-summary`)
      .set('authorization', await bearer(stranger));
    expect(blocked.status).toBe(403);
  });
});

describe('insights', () => {
  it('measures the success metrics over the last 30 days', async () => {
    const res = await request(app)
      .get(`/shops/${shopId}/insights`)
      .set('authorization', await bearer(owner));
    const insights = insightsSchema.parse(res.body);
    expect(insights).toMatchObject({
      days: 30,
      autoApprovedPayments: { count: 1, total: 1 },
      fraudBlocked: { count: 1, amount: '3500.00' },
      farQuotesDriverFound: { count: 0, total: 0 },
      delivery: { trips: 1, cost: '100.00', saverSavings: '60.00' },
      guard: { accepted: 0, rejected: 0, needsOwner: 1 },
    });
    expect(insights.posts).toEqual([
      expect.objectContaining({ productTitle: 'Nike Air', taps: 5, paidOrders: 2 }),
    ]);
  });

  it('is only for the shop’s owners', async () => {
    const res = await request(app)
      .get(`/shops/${shopId}/insights`)
      .set('authorization', await bearer(stranger));
    expect(res.status).toBe(403);
  });
});

describe('ledger settings', () => {
  const path = () => `/shops/${shopId}/ledger`;

  it('shows the spreadsheet and that rows wait while the server has no Google credentials', async () => {
    const res = await request(app)
      .get(path())
      .set('authorization', await bearer(owner));
    expect(ledgerSettingsSchema.parse(res.body)).toMatchObject({
      spreadsheetId,
      serviceAccountEmail: null,
      pending: 1,
    });
  });

  it('checks the spreadsheet ID, then saves or disconnects it', async () => {
    const auth = await bearer(owner);
    const invalid = await request(app)
      .put(path())
      .set('authorization', auth)
      .send({ spreadsheetId: 'https://docs.google.com' });
    expect(invalid.status).toBe(400);
    const off = await request(app)
      .put(path())
      .set('authorization', auth)
      .send({ spreadsheetId: null });
    expect(ledgerSettingsSchema.parse(off.body).spreadsheetId).toBeNull();
    const blocked = await request(app)
      .put(path())
      .set('authorization', await bearer(stranger))
      .send({ spreadsheetId });
    expect(blocked.status).toBe(403);
  });
});
