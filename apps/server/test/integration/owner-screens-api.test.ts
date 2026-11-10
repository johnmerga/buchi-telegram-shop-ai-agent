import { Readable } from 'node:stream';
import {
  aiDecisionSchema,
  approvalOutcomeSchema,
  conversationItemSchema,
  deliveryMapSchema,
  Money,
  paymentDecisionItemSchema,
  paymentReviewItemSchema,
  paymentReviewResultSchema,
  productInputSchema,
  zoneMapSchema,
} from '@buchi/shared';
import { eq, sql, type SQL } from 'drizzle-orm';
import { Api } from 'grammy';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DecisionLog } from '../../src/ai/approvals/decision-log.service';
import { OwnerApprovals } from '../../src/ai/approvals/owner-approvals.service';
import { DecisionsRepo } from '../../src/ai/guard/decisions.repo';
import { connectDatabase } from '../../src/db/client';
import { drivers as driversTable, productVariants } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { createApp } from '../../src/http/app';
import { requireAuth } from '../../src/http/middleware/require-auth';
import { requireShopOwner } from '../../src/http/middleware/require-shop-owner';
import { AuthService } from '../../src/modules/auth/auth.service';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { ZoneFactorsRepo } from '../../src/modules/delivery/zone-factors.repo';
import { ZoneFactorService } from '../../src/modules/delivery/zone-factors.service';
import { zoneOf } from '../../src/modules/delivery/zones.domain';
import { createZonesRouter } from '../../src/modules/delivery/zones.routes';
import { DeliveryJobsRepo } from '../../src/modules/drivers/delivery-jobs.repo';
import { DeliveryMapRepo } from '../../src/modules/drivers/delivery-map.repo';
import { createDeliveryMapRouter } from '../../src/modules/drivers/delivery-map.routes';
import { DeliveryMapService } from '../../src/modules/drivers/delivery-map.service';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { createAiDecisionsRouter } from '../../src/modules/owner/ai-decisions.routes';
import { ConversationsRepo } from '../../src/modules/owner/conversations.repo';
import { createConversationsRouter } from '../../src/modules/owner/conversations.routes';
import { ConversationService } from '../../src/modules/owner/conversations.service';
import { OwnerNotifier } from '../../src/modules/owner/owner-notifier.service';
import { PaymentNotifier } from '../../src/modules/payments/payment-notifier.service';
import { PaymentProofsRepo } from '../../src/modules/payments/payment-proofs.repo';
import { PaymentRecords } from '../../src/modules/payments/payment-records.service';
import { PaymentRefsRepo } from '../../src/modules/payments/payment-refs.repo';
import { PaymentReview } from '../../src/modules/payments/payment-review.service';
import { createPaymentsRouter } from '../../src/modules/payments/payments.routes';
import { RiskSignalsRepo } from '../../src/modules/payments/risk-signals.repo';
import { RiskService } from '../../src/modules/payments/risk.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { TelegramMessenger } from '../../src/telegram/messenger';
import { noEmbeddings } from '../fakes/no-embeddings';
import { launchFields, signInitData } from '../sign-init-data';
import { testDatabaseUrl } from './test-database';
import { StockHoldsRepo } from '../../src/modules/orders/stock-holds.repo';
import { noEvents } from '../fakes/no-events';
import { noPromotions } from '../fakes/no-owner-rules';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const logger = pino({ level: 'silent' });
const clock = () => new Date();

let nextMessageId = 1;
const telegramApi = new Api('test');
telegramApi.config.use((_prev, method) =>
  // Every Bot API call succeeds. These tests check the API, not the chat messages.
  Promise.resolve({
    ok: true,
    result: method === 'sendMessage' ? { message_id: nextMessageId++ } : true,
  } as never),
);
const messenger = new TelegramMessenger(telegramApi);

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
const timers = new TimerService(new TimersRepo(db), logger);
const orders = new OrderService(
  db,
  new OrdersRepo(),
  new EventBus(logger),
  timers,
  new NegotiationService(db, new NegotiationsRepo()),
  noPromotions,
  new StockHoldsRepo(),
);
const proofs = new PaymentProofsRepo();
const risk = new RiskService(new RiskSignalsRepo(db), 'r'.repeat(32));
const review = new PaymentReview(
  db,
  proofs,
  new PaymentRefsRepo(db),
  risk,
  orders,
  customers,
  new PaymentNotifier(shops, orders, messenger, logger),
);
const conversationsRepo = new ConversationsRepo();
const conversations = new ConversationService(
  db,
  conversationsRepo,
  new OwnerNotifier(db, conversationsRepo, shops, messenger, logger),
  messenger,
  timers,
  clock,
);
const decisions = new DecisionsRepo();
const approvedRuns: Record<string, unknown>[] = [];
const approvals = new OwnerApprovals(
  db,
  decisions,
  [
    {
      tool: 'propose_bonus',
      run: (proposed) => {
        approvedRuns.push(proposed);
        return Promise.resolve({ status: 'ok', output: {} });
      },
    },
  ],
  { send: () => Promise.resolve() },
  logger,
  clock,
);
const zoneFactorsRepo = new ZoneFactorsRepo(db);
const screenshot = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const openedFiles: string[] = [];

const botToken = '123456:test-token';
const auth = new AuthService({ botToken, tokenSecret: 't'.repeat(32), now: clock });
const guards = {
  requireAuth: requireAuth((token) => auth.verifyToken(token)),
  requireShopOwner: requireShopOwner((id) => shops.ownedShopIds(id)),
};
const app = createApp({
  logger,
  trustProxyHops: 0,
  routers: [
    createPaymentsRouter({
      records: new PaymentRecords(db, proofs, orders, customers, risk),
      review,
      files: {
        open: (fileId) => {
          openedFiles.push(fileId);
          return Promise.resolve({
            contentType: 'image/jpeg',
            body: Readable.from([Buffer.from(screenshot)]),
          });
        },
      },
      ...guards,
    }),
    createConversationsRouter({ conversations, ...guards }),
    createAiDecisionsRouter({
      log: new DecisionLog(db, decisions, approvals),
      approvals,
      ...guards,
    }),
    createDeliveryMapRouter({
      deliveryMap: new DeliveryMapService(db, new DeliveryMapRepo(), shops),
      ...guards,
    }),
    createZonesRouter({ zoneFactors: new ZoneFactorService(zoneFactorsRepo, clock), ...guards }),
  ],
});

async function bearer(telegramUserId: number): Promise<string> {
  const initData = signInitData(launchFields(telegramUserId, new Date()), botToken);
  return `Bearer ${(await auth.signInWithMiniApp(initData)).token}`;
}
const get = async (path: string, userId: number) =>
  request(app)
    .get(path)
    .set('authorization', await bearer(userId));
const post = async (path: string, userId: number) =>
  request(app)
    .post(path)
    .set('authorization', await bearer(userId))
    .send({});

const owner = 990001;
const stranger = 990002;
const customerPin = { latitude: 9.0203, longitude: 38.8027 };
let shopId = '';
let variantId = '';

async function orderOf(telegramUserId: number, name: string): Promise<string> {
  const customer = await customers.identify(shopId, telegramUserId, name);
  const order = await orders.create(
    shopId,
    {
      customerId: customer.id,
      items: [{ variantId, quantity: 1 }],
      delivery: { type: 'express', fee: Money.of('130'), destination: customerPin },
      paymentDeadline: new Date(Date.now() + 3 * 60 * 60_000),
    },
    'customer',
  );
  return order.id;
}

/** An order whose screenshot Buchi could not decide, as payment verification leaves it. */
async function orderInReview(telegramUserId: number, name: string): Promise<string> {
  const orderId = await orderOf(telegramUserId, name);
  await orders.transition(shopId, orderId, 'payment_submitted', 'customer', 'Screenshot');
  await orders.transition(shopId, orderId, 'payment_unclear', 'system', 'Bank page down');
  const proof = await withShop(db, shopId, (tx) =>
    proofs.insert(tx, {
      shopId,
      orderId,
      telegramFileId: `file-${orderId}`,
      extraction: {
        layout: { value: 'telebirr_web', confidence: 0.95 },
        transactionRef: { value: 'CHK12345', confidence: 0.9 },
        amount: { value: '3630.00', confidence: 0.92 },
        receiverName: { value: 'Selam Shoes', confidence: 0.9 },
        receiverAccount: { value: null, confidence: 0 },
        payerName: { value: name, confidence: 0.8 },
        payerAccount: { value: null, confidence: 0 },
        paidAt: { value: '05-11-2026 10:00:00', confidence: 0.9 },
        status: { value: 'Completed', confidence: 0.9 },
      },
      provider: 'telebirr',
      txRef: 'CHK12345',
      amount: '3630.00',
      rules: { r1: 'pass', r2: 'pass', r3: 'exact', r4: 'pass', r5: 'pass', r6: 'pass' },
      bankCheck: 'UNAVAILABLE',
      decision: 'review',
      reasons: ['bank_unavailable'],
    }),
  );
  return proof.id;
}

beforeAll(async () => {
  shopId = await shops.create(owner, { name: 'Selam Shoes' });
  await shops.setLocation(shopId, { latitude: 9.0108, longitude: 38.7613 });
  const product = await catalog.createProduct(
    shopId,
    productInputSchema.parse({ title: 'Nike Air', pricingMode: 'fixed', price: '3500' }),
  );
  await catalog.setVariants(shopId, product.id, [{ size: '42', color: null, stock: 10 }]);
  variantId = (await catalog.listProducts(shopId))[0]?.variants[0]?.id ?? '';
});

describe('owner screens', () => {
  it('keeps every screen closed to someone who does not own the shop', async () => {
    const paths = [
      'payment-reviews',
      'payment-decisions',
      'conversations',
      'ai-decisions',
      'deliveries',
      'zones',
    ];
    for (const path of paths) {
      expect((await get(`/shops/${shopId}/${path}`, stranger)).status).toBe(403);
    }
    expect((await get(`/shops/${shopId}/payment-reviews`, owner)).status).toBe(200);
  });
});

describe('payment review', () => {
  let proofId = '';

  beforeAll(async () => {
    proofId = await orderInReview(990101, 'Hana');
  });

  it('lists the screenshot with what Buchi read, the rules, the bank result, and risk', async () => {
    const res = await get(`/shops/${shopId}/payment-reviews`, owner);
    const [item] = z.array(paymentReviewItemSchema).parse(res.body);
    expect(item).toMatchObject({
      proofId,
      customerName: 'Hana',
      orderTotal: '3630.00',
      bankCheck: 'UNAVAILABLE',
      reasons: ['bank_unavailable'],
      rules: { r3: 'exact' },
      payerHighRisk: false,
      customerReported: false,
    });
    expect(item?.extraction?.transactionRef).toEqual({ value: 'CHK12345', confidence: 0.9 });
  });

  it('streams the screenshot from Telegram without caching it', async () => {
    const res = await get(`/shops/${shopId}/payment-reviews/${proofId}/screenshot`, owner);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(new Uint8Array(z.instanceof(Buffer).parse(res.body))).toEqual(screenshot);
    expect(openedFiles.at(-1)).toMatch(/^file-/);

    const blocked = await get(`/shops/${shopId}/payment-reviews/${proofId}/screenshot`, stranger);
    expect(blocked.status).toBe(403);
  });

  it('has no screenshot for a payment proven by a receipt link', async () => {
    const orderId = await orderOf(70101, 'Link Customer');
    const proof = await withShop(db, shopId, (tx) =>
      proofs.insert(tx, { shopId, orderId, telegramFileId: null, decision: 'approve' }),
    );
    const res = await get(`/shops/${shopId}/payment-reviews/${proof.id}/screenshot`, owner);
    expect(res.status).toBe(404);
  });

  it('approves once through the same review service as the chat buttons', async () => {
    const path = `/shops/${shopId}/payment-reviews/${proofId}/approve`;
    const res = await post(path, owner);
    expect(paymentReviewResultSchema.parse(res.body).result).toBe('approved');
    expect((await post(path, owner)).status).toBe(409);
    const queue = await get(`/shops/${shopId}/payment-reviews`, owner);
    expect(queue.body).toEqual([]);
  });

  it('rejects a payment, which closes the order', async () => {
    const rejected = await orderInReview(990102, 'Abel');
    const res = await post(`/shops/${shopId}/payment-reviews/${rejected}/reject`, owner);
    expect(paymentReviewResultSchema.parse(res.body).result).toBe('rejected');
    expect((await post(`/shops/${shopId}/payment-reviews/${rejected}/undo`, owner)).status).toBe(
      400,
    );
  });

  it('answers a conflict when a reported payment needs an item that sold out', async () => {
    const orderId = await orderOf(990103, 'Liya');
    await orders.transition(shopId, orderId, 'payment_submitted', 'customer', 'Screenshot');
    await orders.transition(shopId, orderId, 'payment_rejected', 'system', 'Payment rejected');
    const reported = await withShop(db, shopId, (tx) =>
      proofs.insert(tx, {
        shopId,
        orderId,
        telegramFileId: `file-${orderId}`,
        decision: 'reject',
        reasons: ['time'],
        reportedAt: new Date(),
      }),
    );
    const reserve = (reserved: SQL | number) =>
      withShop(db, shopId, (tx) =>
        tx.update(productVariants).set({ reserved }).where(eq(productVariants.id, variantId)),
      );
    const [before] = await withShop(db, shopId, (tx) =>
      tx
        .select({ reserved: productVariants.reserved })
        .from(productVariants)
        .where(eq(productVariants.id, variantId)),
    );
    await reserve(sql`${productVariants.stock}`);

    const res = await post(`/shops/${shopId}/payment-reviews/${reported.id}/approve`, owner);
    await reserve(before?.reserved ?? 0);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: { message: 'The item sold out after the order was closed' },
    });
    expect((await orders.get(shopId, orderId)).status).toBe('payment_rejected');
  });

  it('lists settled payments newest first, with who decided, and not the ones still waiting', async () => {
    const res = await get(`/shops/${shopId}/payment-decisions`, owner);
    const items = z.array(paymentDecisionItemSchema).parse(res.body);
    expect(items.map((i) => [i.customerName, i.outcome, i.decidedBy])).toEqual([
      ['Abel', 'rejected', 'owner'],
      ['Link Customer', 'approved', 'buchi'],
      ['Hana', 'approved', 'owner'],
    ]);
    expect(items.at(-1)).toMatchObject({
      proofId,
      amount: '3630.00',
      provider: 'telebirr',
      bankCheck: 'UNAVAILABLE',
      reasons: ['bank_unavailable'],
    });
  });

  it('finds no proof of another shop', async () => {
    const otherShop = await shops.create(stranger, { name: 'Other' });
    const res = await post(`/shops/${otherShop}/payment-reviews/${proofId}/approve`, stranger);
    expect(res.status).toBe(404);
  });

  it('lists the screenshots that wait for the owner newest first', async () => {
    const older = await orderInReview(990111, 'Liya');
    await withShop(db, shopId, (tx) =>
      tx.execute(
        sql`update payment_proofs set created_at = now() - interval '1 hour' where id = ${older}`,
      ),
    );
    const newer = await orderInReview(990112, 'Yonas');
    const res = await get(`/shops/${shopId}/payment-reviews`, owner);
    const listed = z.array(paymentReviewItemSchema).parse(res.body);
    const ids = listed.map((item) => item.proofId);
    expect(ids[0]).toBe(newer);
    expect(ids.at(-1)).toBe(older);
  });
});

describe('conversations', () => {
  let conversationId = '';

  beforeAll(async () => {
    const customer = { telegramUserId: 990201, name: 'Selam' };
    conversationId = (await conversations.open(shopId, customer)).id;
    await conversations.recordTurns(shopId, customer, [
      { role: 'customer', text: 'Do you have size 42?' },
      { role: 'buchi', text: 'Yes, 3,500 birr.' },
    ]);
  });

  it('lists chats with their last turns and without the customer’s Telegram ID', async () => {
    const res = await get(`/shops/${shopId}/conversations`, owner);
    const listed = z.array(conversationItemSchema).parse(res.body);
    expect(listed.find((item) => item.id === conversationId)).toMatchObject({
      customerName: 'Selam',
      mode: 'agent',
      lastTurns: [
        { role: 'customer', text: 'Do you have size 42?' },
        { role: 'buchi', text: 'Yes, 3,500 birr.' },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain('990201');
  });

  it('takes over and hands back the chat', async () => {
    const base = `/shops/${shopId}/conversations/${conversationId}`;
    const taken = conversationItemSchema.parse((await post(`${base}/take-over`, owner)).body);
    expect(taken.mode).toBe('human');
    expect(taken.handBackAt).not.toBeNull();
    const back = conversationItemSchema.parse((await post(`${base}/hand-back`, owner)).body);
    expect(back).toMatchObject({ mode: 'agent', handBackAt: null });
    expect((await post(`${base}/take-over`, stranger)).status).toBe(403);
  });

  it('lists chats newest first, an owner-run one included where its time puts it', async () => {
    const base = `/shops/${shopId}/conversations/${conversationId}`;
    await post(`${base}/take-over`, owner);
    await withShop(db, shopId, (tx) =>
      tx.execute(
        sql`update conversations set updated_at = now() - interval '1 day' where id = ${conversationId}`,
      ),
    );
    const newer = (await conversations.open(shopId, { telegramUserId: 990202, name: 'Abel' })).id;
    const res = await get(`/shops/${shopId}/conversations`, owner);
    const listed = z.array(conversationItemSchema).parse(res.body);
    expect(listed.map((item) => [item.id, item.mode])).toEqual([
      [newer, 'agent'],
      [conversationId, 'human'],
    ]);
    await post(`${base}/hand-back`, owner);
  });

  it('answers 404 for a chat that does not exist', async () => {
    const res = await post(
      `/shops/${shopId}/conversations/00000000-0000-4000-8000-000000000000/take-over`,
      owner,
    );
    expect(res.status).toBe(404);
  });
});

describe('AI decisions', () => {
  let bonusId = '';
  let farPriceId = '';

  beforeAll(async () => {
    const runId = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
    const scope = { shopId, runId, agent: 'operations' as const };
    [bonusId, farPriceId] = await withShop(db, shopId, async (tx) => [
      await decisions.insert(tx, {
        ...scope,
        tool: 'propose_bonus',
        proposed: { jobId: 'job-1', bonus: '50.00' },
        result: 'needs_owner',
        reason: 'owner_confirms',
        ownerStatus: 'pending',
      }),
      await decisions.insert(tx, {
        ...scope,
        tool: 'propose_delivery_price',
        proposed: { value: '1400.00' },
        limits: { formulaPayout: '600.00', cap: '1000.00' },
        result: 'needs_owner',
        reason: 'above_cap',
        agentReason: 'Drivers asked 1,400 birr for this area last week.',
        evidenceIds: ['quote-1'],
        ownerStatus: 'pending',
      }),
      await decisions.insert(tx, {
        ...scope,
        agent: 'sales',
        tool: 'offer_price',
        proposed: { value: '3000.00' },
        limits: { asking: '3500.00', lowest: '3200.00' },
        result: 'rejected',
        reason: 'below_lowest',
        counteroffer: { value: '3200.00' },
      }),
    ]);
  });

  it('lists decisions with reasons and evidence, and marks which the dashboard can decide', async () => {
    await withShop(db, shopId, (tx) =>
      tx.execute(
        sql`update agent_decisions set created_at = now() - interval '2 days' where id = ${bonusId}`,
      ),
    );
    const res = await get(`/shops/${shopId}/ai-decisions`, owner);
    const listed = z.array(aiDecisionSchema).parse(res.body);
    const times = listed.map((item) => Date.parse(item.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(listed.at(-1)).toMatchObject({ id: bonusId, ownerStatus: 'pending' });
    expect(listed.find((item) => item.id === bonusId)?.ownerCanDecide).toBe(true);
    expect(listed.find((item) => item.id === farPriceId)).toMatchObject({
      ownerCanDecide: false,
      agentReason: 'Drivers asked 1,400 birr for this area last week.',
      evidenceIds: ['quote-1'],
      limits: { cap: '1000.00' },
    });
    expect(listed.find((item) => item.tool === 'offer_price')).toMatchObject({
      result: 'rejected',
      counteroffer: '3200.00',
    });
  });

  it('approves a held action once, through the same claim as the chat buttons', async () => {
    const path = `/shops/${shopId}/ai-decisions/${bonusId}/approve`;
    const first = approvalOutcomeSchema.parse((await post(path, owner)).body);
    expect(first).toEqual({ status: 'approved', error: null });
    const second = approvalOutcomeSchema.parse((await post(path, owner)).body);
    expect(second.status).toBe('already_decided');
    expect(approvedRuns).toEqual([{ jobId: 'job-1', bonus: '50.00' }]);
  });

  it('leaves a far-area price above the cap to its own buttons in the chat', async () => {
    const res = await post(`/shops/${shopId}/ai-decisions/${farPriceId}/approve`, owner);
    expect(res.status).toBe(404);
    const listed = z
      .array(aiDecisionSchema)
      .parse((await get(`/shops/${shopId}/ai-decisions`, owner)).body);
    expect(listed.find((item) => item.id === farPriceId)?.ownerStatus).toBe('pending');
  });
});

describe('deliveries map', () => {
  it('shows open jobs with their driver and stops in order', async () => {
    const orderId = await orderOf(990301, 'Mimi');
    await withShop(db, shopId, async (tx) => {
      const [driver] = await tx
        .insert(driversTable)
        .values({ shopId, username: 'abebe_rides', name: 'Abebe' })
        .returning();
      const job = await new DeliveryJobsRepo().insertJob(tx, {
        shopId,
        special: false,
        payout: '120.00',
        separateTripsPayout: '120.00',
        routeMeters: 5200,
        estimatedMinutes: 18,
        stops: [{ orderId, routingSeconds: 900, expectedSeconds: 1000 }],
      });
      await new DeliveryJobsRepo().assign(tx, job.id, {
        driverId: driver?.id ?? '',
        payout: '120.00',
        acceptedAt: new Date(),
      });
    });

    const res = await get(`/shops/${shopId}/deliveries`, owner);
    const map = deliveryMapSchema.parse(res.body);
    expect(map.shopPin).toEqual({ latitude: 9.0108, longitude: 38.7613 });
    expect(map.jobs).toEqual([
      expect.objectContaining({
        status: 'assigned',
        far: false,
        payout: '120.00',
        driverName: 'Abebe',
        stops: [{ orderId, position: 1, pin: customerPin, delivered: false }],
      }),
    ]);
  });

  it('lists the newest job first', async () => {
    const orderId = await orderOf(990302, 'Sara');
    await withShop(db, shopId, (tx) =>
      new DeliveryJobsRepo().insertJob(tx, {
        shopId,
        special: true,
        payout: '300.00',
        separateTripsPayout: '300.00',
        routeMeters: 21000,
        estimatedMinutes: 50,
        stops: [{ orderId, routingSeconds: 2800, expectedSeconds: 3000 }],
      }),
    );
    const map = deliveryMapSchema.parse((await get(`/shops/${shopId}/deliveries`, owner)).body);
    expect(map.jobs.map((job) => job.stops[0]?.orderId)).toEqual([orderId, expect.any(String)]);
  });
});

describe('zones map', () => {
  it('draws learned zones as hexagons with both time bands', async () => {
    const zone = zoneOf(customerPin);
    await zoneFactorsRepo.saveTimeFactors([
      { zone, band: 'peak', factor: 1.6, trips: 12 },
      { zone, band: 'off_peak', factor: 1.2, trips: 30 },
      { zone: 'all', band: 'peak', factor: 1.4, trips: 200 },
    ]);
    const res = await get(`/shops/${shopId}/zones`, owner);
    const map = zoneMapSchema.parse(res.body);
    const found = map.zones.find((item) => item.zone === zone);
    expect(found).toMatchObject({
      peak: { factor: 1.6, trips: 12 },
      offPeak: { factor: 1.2, trips: 30 },
    });
    expect(found?.boundary.length).toBeGreaterThanOrEqual(6);
    expect(map.zones.some((item) => item.zone === 'all')).toBe(false);
  });
});
