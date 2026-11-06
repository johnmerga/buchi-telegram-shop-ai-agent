import {
  acceptResultSchema,
  deliverySettingsViewSchema,
  driverBoardSchema,
  driverListItemSchema,
  holdResultSchema,
  Money,
  orderBoardItemSchema,
  productInputSchema,
  productWithVariantsSchema,
  shopDetailsSchema,
  trackedOrderSchema,
} from '@buchi/shared';
import { Api } from 'grammy';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connectDatabase } from '../../src/db/client';
import { createApp } from '../../src/http/app';
import { requireAuth } from '../../src/http/middleware/require-auth';
import { requireShopOwner } from '../../src/http/middleware/require-shop-owner';
import { AuthService } from '../../src/modules/auth/auth.service';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { createCatalogRouter } from '../../src/modules/catalog/catalog.routes';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { DeliverySettingsRepo } from '../../src/modules/delivery/delivery-settings.repo';
import { createDeliveryRouter } from '../../src/modules/delivery/delivery.routes';
import { DeliveryService } from '../../src/modules/delivery/delivery.service';
import { straightLineMatrix } from '../../src/modules/delivery/distance.domain';
import { RouteService } from '../../src/modules/delivery/route.service';
import { SaverScheduleService } from '../../src/modules/delivery/saver-schedule.service';
import { DeliveryJobsRepo } from '../../src/modules/drivers/delivery-jobs.repo';
import { DispatchService } from '../../src/modules/drivers/dispatch.service';
import { createDriverAppRouter } from '../../src/modules/drivers/driver-app.routes';
import { DriverBoardRepo } from '../../src/modules/drivers/driver-board.repo';
import { DriverBoardService } from '../../src/modules/drivers/driver-board.service';
import { DriversRepo } from '../../src/modules/drivers/drivers.repo';
import { createDriversRouter } from '../../src/modules/drivers/drivers.routes';
import { DriverService } from '../../src/modules/drivers/drivers.service';
import { JobOffers } from '../../src/modules/drivers/job-offers.service';
import { DeliveryOwnerAlerts } from '../../src/modules/drivers/owner-alerts.service';
import { SpecialJobsRepo } from '../../src/modules/drivers/special-jobs.repo';
import { SpecialOffers } from '../../src/modules/drivers/special-offers.service';
import { TripService } from '../../src/modules/drivers/trips.service';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { OrderBoardRepo } from '../../src/modules/orders/order-board.repo';
import { OrderBoardService } from '../../src/modules/orders/order-board.service';
import { OrderTrackingService } from '../../src/modules/orders/order-tracking.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { createOrdersRouter } from '../../src/modules/orders/orders.routes';
import { OrderService } from '../../src/modules/orders/orders.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { createShopsRouter } from '../../src/modules/shops/shops.routes';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { TelegramMessenger } from '../../src/telegram/messenger';
import { noEmbeddings } from '../fakes/no-embeddings';
import { launchFields, signInitData } from '../sign-init-data';
import { testDatabaseUrl } from './test-database';
import { StockHoldsRepo } from '../../src/modules/orders/stock-holds.repo';
import { noEvents } from '../fakes/no-events';
import { noPauses, noPromotions } from '../fakes/no-owner-rules';

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
const events = new EventBus(logger);
const orders = new OrderService(
  db,
  new OrdersRepo(),
  events,
  timers,
  new NegotiationService(db, new NegotiationsRepo()),
  noPromotions,
  new StockHoldsRepo(),
);
const routes = new RouteService(
  {
    route: () => Promise.resolve({ meters: 5000, seconds: 900 }),
    matrix: (points) => Promise.resolve(straightLineMatrix(points)),
  },
  logger,
  clock,
);
const deliverySettings = new DeliverySettingsRepo();
const delivery = new DeliveryService(
  db,
  deliverySettings,
  shops,
  routes,
  () => Promise.resolve(1),
  noPauses,
);
const driversRepo = new DriversRepo();
const jobsRepo = new DeliveryJobsRepo();
const drivers = new DriverService(db, driversRepo, shops, 'buchi_test_bot', clock);
const offers = new JobOffers(db, jobsRepo, driversRepo, shops, messenger, timers, logger, clock);
const dispatch = new DispatchService(
  db,
  jobsRepo,
  driversRepo,
  offers,
  { assignHolder: () => Promise.reject(new Error('unused')) },
  orders,
  customers,
  shops,
  delivery,
  messenger,
  clock,
);
events.subscribe('order.transitioned', (event) => dispatch.orderTransitioned(event));
const trips = new TripService(
  db,
  jobsRepo,
  driversRepo,
  orders,
  customers,
  messenger,
  new DeliveryOwnerAlerts(shops, messenger, logger),
  events,
  timers,
  { recordLeg: () => Promise.resolve() },
  logger,
  clock,
);

const specialOffers = new SpecialOffers(
  db,
  jobsRepo,
  new SpecialJobsRepo(),
  driversRepo,
  offers,
  timers,
  events,
  clock,
);

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
    createShopsRouter({ shops, ...guards }),
    createCatalogRouter({
      catalog,
      uploads: { upload: () => Promise.reject(new Error('not used')) },
      files: { open: () => Promise.reject(new Error('not used')) },
      ...guards,
    }),
    createDeliveryRouter({
      delivery,
      saverSchedule: new SaverScheduleService(db, deliverySettings, timers, clock),
      ...guards,
    }),
    createDriversRouter({ drivers, ...guards }),
    createOrdersRouter({
      board: new OrderBoardService(db, new OrderBoardRepo()),
      tracking: new OrderTrackingService(orders, shops),
      ...guards,
    }),
    createDriverAppRouter({
      board: new DriverBoardService(
        db,
        new DriverBoardRepo(),
        jobsRepo,
        driversRepo,
        shops,
        orders,
        customers,
      ),
      dispatch,
      specialOffers,
      trips,
      requireAuth: guards.requireAuth,
    }),
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
const post = async (path: string, userId: number, body: object = {}) =>
  request(app)
    .post(path)
    .set('authorization', await bearer(userId))
    .send(body);

const owner = 880001;
const stranger = 880002;
const customer = 880101;
const otherCustomer = 880102;
const driver = 880201;
const secondDriver = 880202;
const customerPin = { latitude: 8.9970566, longitude: 38.7866129 };
const settings = {
  baseFee: '40.00',
  ratePerKm: '12.50',
  ratePerMinute: '1.50',
  freeRadiusKm: 2.5,
  standardRangeKm: 8,
  farRangeKm: 20,
  farCap: '1000.00',
  saverDiscountPercent: 15,
};
let shopId = '';
let variantId = '';

async function addDriver(telegramUserId: number, username: string): Promise<void> {
  const { link } = await drivers.invite(shopId, username);
  const token = link.split('start=drv_')[1] ?? '';
  await drivers.link(token, { telegramUserId, username, name: username });
  await drivers.savePhone(telegramUserId, `+2519${String(telegramUserId)}`);
  await drivers.setAvailability(telegramUserId, true);
}

/** Places an Express order and approves its payment, which offers it to the drivers. */
async function paidExpressOrder(telegramUserId: number): Promise<string> {
  const row = await customers.identify(shopId, telegramUserId, 'Hana');
  await customers.setPhone(shopId, row.id, '+251911000111');
  const order = await orders.create(
    shopId,
    {
      customerId: row.id,
      items: [{ variantId, quantity: 1 }],
      delivery: { type: 'express', fee: Money.of('130'), destination: customerPin },
      paymentDeadline: new Date(Date.now() + 3 * 60 * 60_000),
    },
    'customer',
  );
  await orders.transition(shopId, order.id, 'payment_submitted', 'customer', 'Screenshot');
  await orders.transition(shopId, order.id, 'payment_approved', 'system', 'Paid');
  return order.id;
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

describe('owner read API', () => {
  it('returns responses that match the shared schemas the web app parses', async () => {
    const shop = await get(`/shops/${shopId}`, owner);
    expect(shopDetailsSchema.parse(shop.body).name).toBe('Selam Shoes');
    const products = await get(`/shops/${shopId}/products`, owner);
    expect(z.array(productWithVariantsSchema).parse(products.body)[0]?.variants[0]).toMatchObject({
      size: '42',
      stock: 10,
    });
  });

  it('shows delivery settings as empty until the owner saves them', async () => {
    const before = await get(`/shops/${shopId}/delivery-settings`, owner);
    expect(deliverySettingsViewSchema.parse(before.body)).toEqual({
      settings: null,
      saverRunTimes: [],
    });
    await delivery.saveSettings(shopId, settings);
    const after = await get(`/shops/${shopId}/delivery-settings`, owner);
    expect(deliverySettingsViewSchema.parse(after.body).settings).toEqual(settings);
  });

  it('lists invited and linked drivers without their phone numbers', async () => {
    await addDriver(driver, 'abebe_rides');
    await drivers.invite(shopId, 'kebede_rides');
    const res = await get(`/shops/${shopId}/drivers`, owner);
    const listed = z.array(driverListItemSchema).parse(res.body);
    expect(listed.map(({ username, linked }) => ({ username, linked }))).toEqual([
      { username: 'abebe_rides', linked: true },
      { username: 'kebede_rides', linked: false },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('+2519');
  });

  it('keeps every read route closed to someone who does not own the shop', async () => {
    for (const path of ['orders', 'drivers', 'delivery-settings']) {
      expect((await get(`/shops/${shopId}/${path}`, stranger)).status).toBe(403);
    }
  });
});

describe('orders across the Mini Apps', () => {
  let orderId = '';
  let offerId = '';

  beforeAll(async () => {
    await addDriver(secondDriver, 'hana_rides');
    orderId = await paidExpressOrder(customer);
  });

  it('puts the order on the owner board with its lines', async () => {
    const res = await get(`/shops/${shopId}/orders`, owner);
    const [first] = z.array(orderBoardItemSchema).parse(res.body);
    expect(first).toMatchObject({
      id: orderId,
      status: 'dispatching',
      deliveryType: 'express',
      customerName: 'Hana',
      lines: [{ title: 'Nike Air', size: '42', quantity: 1 }],
    });
  });

  it('lets the customer track only their own order', async () => {
    const own = await get(`/customer/orders/${orderId}`, customer);
    expect(trackedOrderSchema.parse(own.body)).toMatchObject({
      shopName: 'Selam Shoes',
      status: 'dispatching',
      total: '3630.00',
    });
    expect((await get(`/customer/orders/${orderId}`, otherCustomer)).status).toBe(404);
  });

  it('shows the open offer to drivers without the customer’s details', async () => {
    const res = await get('/driver/board', driver);
    const board = driverBoardSchema.parse(res.body);
    expect(board.offers).toHaveLength(1);
    expect(board.offers[0]).toMatchObject({
      shopName: 'Selam Shoes',
      stops: 1,
      far: false,
      raised: false,
    });
    expect(JSON.stringify(res.body)).not.toContain('+251911000111');
    offerId = board.offers[0]?.offerId ?? '';
  });

  it('gives the job to the first driver who accepts', async () => {
    const first = await post(`/driver/offers/${offerId}/accept`, driver);
    expect(acceptResultSchema.parse(first.body).result).toBe('accepted');
    const second = await post(`/driver/offers/${offerId}/accept`, secondDriver);
    expect(acceptResultSchema.parse(second.body).result).toBe('closed');
    expect((await post(`/driver/offers/${offerId}/accept`, stranger)).status).toBe(404);
  });

  it('shows the accepted trip with the customer’s phone and pin', async () => {
    const board = driverBoardSchema.parse((await get('/driver/board', driver)).body);
    expect(board.offers).toEqual([]);
    expect(board.trips[0]).toMatchObject({
      status: 'assigned',
      stops: [{ customerName: 'Hana', phone: '+251911000111', pin: customerPin, delivered: false }],
    });
    const other = driverBoardSchema.parse((await get('/driver/board', secondDriver)).body);
    expect(other.trips).toEqual([]);
  });

  it('runs pickup and delivery for the assigned driver only', async () => {
    const board = driverBoardSchema.parse((await get('/driver/board', driver)).body);
    const trip = board.trips[0];
    const stopId = trip?.stops[0]?.stopId ?? '';

    expect((await post(`/driver/jobs/${trip?.jobId ?? ''}/picked-up`, secondDriver)).status).toBe(
      404,
    );
    expect((await post(`/driver/jobs/${trip?.jobId ?? ''}/picked-up`, driver)).status).toBe(204);
    const invalid = await post(`/driver/stops/${stopId}/delivered`, driver, { latitude: 'here' });
    expect(invalid.status).toBe(400);
    const delivered = await post(`/driver/stops/${stopId}/delivered`, driver, customerPin);
    expect(delivered.status).toBe(204);

    expect((await orders.get(shopId, orderId)).status).toBe('delivered');
    const after = driverBoardSchema.parse((await get('/driver/board', driver)).body);
    expect(after.trips).toEqual([]);
    expect(after.earnings).toEqual([
      { shopName: 'Selam Shoes', deliveredTrips: 1, payout: trip?.payout },
    ]);
  });
});

describe('far-area offers on the driver board', () => {
  let offerId = '';

  beforeAll(async () => {
    const row = await customers.identify(shopId, 880103, 'Selam');
    const order = await orders.create(
      shopId,
      {
        customerId: row.id,
        items: [{ variantId, quantity: 1 }],
        delivery: { type: 'far', fee: Money.of('400'), destination: customerPin },
        paymentDeadline: new Date(Date.now() + 3 * 60 * 60_000),
      },
      'customer',
    );
    await specialOffers.open(
      shopId,
      {
        stop: { orderId: order.id, routingSeconds: 1800, expectedSeconds: 2100 },
        routeMeters: 18_000,
        estimatedMinutes: 35,
      },
      Money.of('350'),
      false,
    );
  });

  it('lists the far-area offer as far, so the app holds it instead of accepting it', async () => {
    const board = driverBoardSchema.parse((await get('/driver/board', driver)).body);
    const far = board.offers.find((offer) => offer.far);
    expect(far).toMatchObject({ price: '350.00', routeMeters: 18_000, far: true });
    offerId = far?.offerId ?? '';
  });

  it('lets the first driver hold it and lists it under their held offers only', async () => {
    const first = await post(`/driver/offers/${offerId}/hold`, driver);
    expect(holdResultSchema.parse(first.body).result).toBe('held');
    const second = await post(`/driver/offers/${offerId}/hold`, secondDriver);
    expect(holdResultSchema.parse(second.body).result).toBe('closed');
    expect((await post(`/driver/offers/${offerId}/hold`, stranger)).status).toBe(404);

    const holder = driverBoardSchema.parse((await get('/driver/board', driver)).body);
    expect(holder.held.map((offer) => offer.offerId)).toEqual([offerId]);
    expect(holder.offers.some((offer) => offer.offerId === offerId)).toBe(false);
    const other = driverBoardSchema.parse((await get('/driver/board', secondDriver)).body);
    expect(other.held).toEqual([]);
  });
});
