import { Money, productInputSchema } from '@buchi/shared';
import { and, eq } from 'drizzle-orm';
import { Api } from 'grammy';
import type { Chat, Update, User } from 'grammy/types';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connectDatabase } from '../../src/db/client';
import { deliveryJobs, jobStops, timers } from '../../src/db/schema';
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
import { DeliverySettingsRepo } from '../../src/modules/delivery/delivery-settings.repo';
import { DeliveryService } from '../../src/modules/delivery/delivery.service';
import { straightLineMatrix } from '../../src/modules/delivery/distance.domain';
import type { Coordinates } from '../../src/modules/delivery/location.domain';
import { RouteService } from '../../src/modules/delivery/route.service';
import { ZoneFactorsRepo } from '../../src/modules/delivery/zone-factors.repo';
import { ZoneFactorService } from '../../src/modules/delivery/zone-factors.service';
import { DeliveryJobsRepo } from '../../src/modules/drivers/delivery-jobs.repo';
import { createDispatchHandlers } from '../../src/modules/drivers/dispatch.handlers';
import { DispatchService } from '../../src/modules/drivers/dispatch.service';
import { createDriverHandlers } from '../../src/modules/drivers/drivers.handlers';
import { DriversRepo } from '../../src/modules/drivers/drivers.repo';
import { createDriversRouter } from '../../src/modules/drivers/drivers.routes';
import { DriverService } from '../../src/modules/drivers/drivers.service';
import { JobOffers, OFFER_UNANSWERED_TIMER } from '../../src/modules/drivers/job-offers.service';
import { LiveTracking } from '../../src/modules/drivers/live-tracking.service';
import { DeliveryOwnerAlerts } from '../../src/modules/drivers/owner-alerts.service';
import { SaverRunService } from '../../src/modules/drivers/saver-runs.service';
import { RECEIPT_TIMER, TripService } from '../../src/modules/drivers/trips.service';
import { createJobsRouter } from '../../src/modules/jobs/jobs.routes';
import { JobService } from '../../src/modules/jobs/jobs.service';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { orderReference } from '../../src/modules/orders/orders.domain';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { createConversationHandlers } from '../../src/modules/owner/conversations.handlers';
import { ConversationsRepo } from '../../src/modules/owner/conversations.repo';
import { ConversationService } from '../../src/modules/owner/conversations.service';
import { OwnerNotifier } from '../../src/modules/owner/owner-notifier.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { createBot } from '../../src/telegram/bot';
import { TelegramLiveMap } from '../../src/telegram/live-map';
import { TelegramMessenger } from '../../src/telegram/messenger';
import { launchFields, signInitData } from '../sign-init-data';
import { noEmbeddings } from '../fakes/no-embeddings';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { testDatabaseUrl } from './test-database';
import { StockHoldsRepo } from '../../src/modules/orders/stock-holds.repo';
import { noEvents } from '../fakes/no-events';
import { noPauses, noPromotions } from '../fakes/no-owner-rules';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const logger = pino({ level: 'silent' });
const botInfo = {
  id: 1,
  is_bot: true as const,
  first_name: 'Buchi',
  username: 'buchi_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};
const clock = () => new Date();

interface Call {
  method: string;
  chatId: number | undefined;
  text: string | undefined;
  payload: Record<string, unknown>;
}
const calls: Call[] = [];
let nextMessageId = 7000;
const sendsMessage = new Set(['sendMessage', 'sendLocation']);
const fakeTelegram = (api: Api) => {
  api.config.use((_prev, method, payload) => {
    const fields: Record<string, unknown> = { ...payload };
    calls.push({
      method,
      chatId: typeof fields.chat_id === 'number' ? fields.chat_id : undefined,
      text: typeof fields.text === 'string' ? fields.text : undefined,
      payload: fields,
    });
    return Promise.resolve({
      ok: true,
      result: sendsMessage.has(method) ? { message_id: nextMessageId++ } : true,
    } as never);
  });
};

const messengerApi = new Api('test');
fakeTelegram(messengerApi);
const messenger = new TelegramMessenger(messengerApi);

const shops = new ShopsService(db, new ShopsRepo(db), {
  verifyPostingRights: () => Promise.reject(new Error('unused')),
});
const catalog = new CatalogService(
  db,
  new CatalogRepo(),
  shops,
  { publish: () => Promise.reject(new Error('unused')) },
  botInfo.username,
  noEmbeddings,
  noEvents,
);
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const timerService = new TimerService(new TimersRepo(db), logger);
const events = new EventBus(logger);
const orders = new OrderService(
  db,
  new OrdersRepo(),
  events,
  timerService,
  new NegotiationService(db, new NegotiationsRepo()),
  noPromotions,
  new StockHoldsRepo(),
);
/** Every road trip from the shop is 5 km and 15 minutes. Matrices come from straight lines. */
const routes = new RouteService(
  {
    route: () => Promise.resolve({ meters: 5000, seconds: 900 }),
    matrix: (points) => Promise.resolve(straightLineMatrix(points)),
  },
  logger,
  clock,
);
const zoneFactors = new ZoneFactorService(new ZoneFactorsRepo(db), clock);
const delivery = new DeliveryService(
  db,
  new DeliverySettingsRepo(),
  shops,
  routes,
  () => Promise.resolve(1),
  noPauses,
);
const conversationsRepo = new ConversationsRepo();
const notifier = new OwnerNotifier(db, conversationsRepo, shops, messenger, logger);
const conversations = new ConversationService(
  db,
  conversationsRepo,
  notifier,
  messenger,
  timerService,
  clock,
);

const driversRepo = new DriversRepo();
const jobsRepo = new DeliveryJobsRepo();
const drivers = new DriverService(db, driversRepo, shops, botInfo.username, clock);
const offers = new JobOffers(
  db,
  jobsRepo,
  driversRepo,
  shops,
  messenger,
  timerService,
  logger,
  clock,
);
const alerts = new DeliveryOwnerAlerts(shops, messenger, logger);
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
/** Live maps follow their own clock, so a test can space or age Live Location updates. */
let liveNow = new Date();
const tracking = new LiveTracking(
  db,
  jobsRepo,
  driversRepo,
  orders,
  customers,
  messenger,
  new TelegramLiveMap(messengerApi),
  logger,
  () => liveNow,
);
const trips = new TripService(
  db,
  jobsRepo,
  driversRepo,
  orders,
  customers,
  messenger,
  alerts,
  events,
  timerService,
  zoneFactors,
  tracking,
  logger,
  clock,
);
const saverRuns = new SaverRunService(
  orders,
  shops,
  routes,
  delivery,
  { claim: () => Promise.reject(new Error('unused')) },
  dispatch,
  logger,
);

const bot = createBot({
  token: 'test',
  botInfo,
  ownedShopIds: (id) => shops.ownedShopIds(id),
  driverShopIds: (id) => drivers.shopIds(id),
  handlers: [
    createDriverHandlers(drivers),
    createDispatchHandlers({
      dispatch,
      trips,
      tracking,
      specialOffers: { hold: () => Promise.reject(new Error('unused')) },
    }),
    createConversationHandlers({ conversations, customers }),
  ],
});
fakeTelegram(bot.api);

const botToken = '123456:test-token';
const jobSecret = 'j'.repeat(32);
const auth = new AuthService({ botToken, tokenSecret: 't'.repeat(32), now: clock });
const app = createApp({
  logger,
  trustProxyHops: 0,
  routers: [
    createDriversRouter({
      drivers,
      requireAuth: requireAuth((token) => auth.verifyToken(token)),
      requireShopOwner: requireShopOwner((id) => shops.ownedShopIds(id)),
    }),
    createJobsRouter(new JobService(new Map([['saver-run', () => saverRuns.runAll()]])), jobSecret),
  ],
});

async function bearer(telegramUserId: number): Promise<string> {
  const initData = signInitData(launchFields(telegramUserId, new Date()), botToken);
  return `Bearer ${(await auth.signInWithMiniApp(initData)).token}`;
}

const userOf = (id: number, name: string, username?: string): User => ({
  id,
  is_bot: false,
  first_name: name,
  ...(username === undefined ? {} : { username }),
});
const privateChat = (user: User): Chat.PrivateChat => ({
  id: user.id,
  type: 'private',
  first_name: user.first_name,
});

let updateId = 1;
const command = (from: User, text: string): Update => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    date: 0,
    chat: privateChat(from),
    from,
    text,
    entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]?.length ?? 0 }],
  },
});
const contact = (from: User, phone: string): Update => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    date: 0,
    chat: privateChat(from),
    from,
    contact: { phone_number: phone, first_name: from.first_name, user_id: from.id },
  },
});
const location = (from: User, point: Coordinates): Update => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    date: 0,
    chat: privateChat(from),
    from,
    location: point,
  },
});
const tap = (from: User, data: string, messageId = 1): Update => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    from,
    chat_instance: '1',
    data,
    message: { message_id: messageId, date: 0, chat: privateChat(from), text: 'button' },
  },
});

const sentTo = (chatId: number) =>
  calls.filter((call) => call.method === 'sendMessage' && call.chatId === chatId);
const lastTo = (chatId: number) => sentTo(chatId).at(-1);
const answers = () =>
  calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.payload.text);

/** The callback data of a sent message's buttons. */
function buttonsOf(call: Call | undefined): string[] {
  const markup = call?.payload.reply_markup;
  if (typeof markup !== 'object' || markup === null || !('inline_keyboard' in markup)) return [];
  const rows = markup.inline_keyboard as { callback_data: string }[][];
  return rows.flat().map((button) => button.callback_data);
}

/** The offer's ID, from the **Accept** button of the latest offer that a driver received. */
function offerIdFor(driverId: number): string {
  const accept = buttonsOf(lastTo(driverId)).find((data) => data.startsWith('job:accept:'));
  if (!accept) throw new Error('The driver has no offer');
  return accept.slice('job:accept:'.length);
}

const settings = {
  baseFee: '40',
  ratePerKm: '12.50',
  ratePerMinute: '1.50',
  freeRadiusKm: 2.5,
  standardRangeKm: 8,
  farRangeKm: 20,
  farCap: '1000',
  saverDiscountPercent: 15,
};
const shopPin = { latitude: 9.0108, longitude: 38.7613 };
const customerPin = { latitude: 8.9970566, longitude: 38.7866129 };

async function setUpShop(owner: number): Promise<{ shopId: string; variantId: string }> {
  const shopId = await shops.create(owner, { name: `Shop ${String(owner)}` });
  await shops.setLocation(shopId, shopPin);
  await delivery.saveSettings(shopId, settings);
  const product = await catalog.createProduct(
    shopId,
    productInputSchema.parse({ title: 'Nike Air', pricingMode: 'fixed', price: '3500' }),
  );
  await catalog.setVariants(shopId, product.id, [{ size: '42', color: null, stock: 100 }]);
  const listed = await catalog.listProducts(shopId);
  return { shopId, variantId: listed[0]?.variants[0]?.id ?? '' };
}

/** Links a driver through the service, as the invite flow test does through the bot. */
async function addDriver(shopId: string, user: User): Promise<void> {
  const username = user.username ?? '';
  const { link } = await drivers.invite(shopId, username);
  const token = link.split('start=drv_')[1] ?? '';
  await drivers.link(token, { telegramUserId: user.id, username, name: user.first_name });
  await drivers.savePhone(user.id, `+2519${String(user.id)}`);
  await drivers.setAvailability(user.id, true);
}

/** Places and pays an order. Paying it starts dispatch through the domain event. */
async function paidOrder(
  shop: { shopId: string; variantId: string },
  customer: User,
  option: { type: 'express' | 'saver'; pin: Coordinates } | { type: 'pickup' },
): Promise<string> {
  const row = await customers.identify(shop.shopId, customer.id, customer.first_name);
  await customers.setPhone(shop.shopId, row.id, `+25191${String(customer.id)}`);
  const order = await orders.create(
    shop.shopId,
    {
      customerId: row.id,
      items: [{ variantId: shop.variantId, quantity: 1 }],
      delivery:
        option.type === 'pickup'
          ? option
          : { type: option.type, fee: Money.of('130'), destination: option.pin },
      paymentDeadline: new Date(Date.now() + 3 * 60 * 60_000),
    },
    'customer',
  );
  await orders.transition(shop.shopId, order.id, 'payment_submitted', 'customer', 'Screenshot');
  await orders.transition(shop.shopId, order.id, 'payment_approved', 'system', 'Paid');
  return order.id;
}

const statusOf = async (shopId: string, orderId: string) =>
  (await orders.get(shopId, orderId)).status;

const jobOf = (shopId: string, orderId: string) =>
  withShop(db, shopId, async (tx) => {
    const [row] = await tx
      .select({ job: deliveryJobs, stop: jobStops })
      .from(jobStops)
      .innerJoin(deliveryJobs, eq(deliveryJobs.id, jobStops.jobId))
      .where(eq(jobStops.orderId, orderId));
    return row;
  });

const timerFor = async (kind: string, targetId: string) => {
  const [row] = await db
    .select()
    .from(timers)
    .where(and(eq(timers.kind, kind), eq(timers.targetId, targetId)));
  return row;
};

const owner = 990001;
const abebe = userOf(990101, 'Abebe', 'Abebe_Rides');
const hana = userOf(990201, 'Hana');
let shop = { shopId: '', variantId: '' };

beforeAll(async () => {
  shop = await setUpShop(owner);
});

describe('driver invites', () => {
  let link = '';

  it('gives the owner a one-time link for a username', async () => {
    const response = await request(app)
      .post(`/shops/${shop.shopId}/drivers`)
      .set('authorization', await bearer(owner))
      .send({ username: '@Abebe_Rides' });
    expect(response.status).toBe(201);
    link = z.object({ link: z.string() }).parse(response.body).link;
    expect(link).toMatch(/^https:\/\/t\.me\/buchi_test_bot\?start=drv_[A-Za-z0-9_-]{32}$/);
  });

  it('keeps other users from inviting drivers to the shop', async () => {
    const response = await request(app)
      .post(`/shops/${shop.shopId}/drivers`)
      .set('authorization', await bearer(990002))
      .send({ username: 'someone_else' });
    expect(response.status).toBe(403);
  });

  it('rejects the link when someone else opens it', async () => {
    const kebede = userOf(990102, 'Kebede', 'kebede_k');
    await bot.handleUpdate(command(kebede, `/start ${link.split('start=')[1] ?? ''}`));
    expect(lastTo(kebede.id)?.text).toContain('for another Telegram username');
    expect(await drivers.shopIds(kebede.id)).toEqual([]);
  });

  it('links the invited username by Telegram user ID and asks for the phone number', async () => {
    await bot.handleUpdate(command(abebe, `/start ${link.split('start=')[1] ?? ''}`));
    expect(sentTo(abebe.id).at(-2)?.text).toContain(`You now deliver for Shop ${String(owner)}`);
    expect(lastTo(abebe.id)?.payload.reply_markup).toMatchObject({
      keyboard: [[{ request_contact: true }]],
    });
    expect(await drivers.shopIds(abebe.id)).toEqual([shop.shopId]);
  });

  it('works only once', async () => {
    await bot.handleUpdate(command(abebe, `/start ${link.split('start=')[1] ?? ''}`));
    expect(lastTo(abebe.id)?.text).toContain('not valid');
  });

  it('saves the phone, then lets the driver go available', async () => {
    await bot.handleUpdate(contact(abebe, '+251911000001'));
    expect(buttonsOf(lastTo(abebe.id))).toEqual(['duty:on']);

    await bot.handleUpdate(tap(abebe, 'duty:on'));
    const edit = calls.filter((c) => c.method === 'editMessageText').at(-1);
    expect(edit?.text).toContain('You are available');
    expect(await drivers.isAvailable(abebe.id)).toBe(true);
  });

  it('refuses to invite a username that already joined', async () => {
    const response = await request(app)
      .post(`/shops/${shop.shopId}/drivers`)
      .set('authorization', await bearer(owner))
      .send({ username: 'abebe_rides' });
    expect(response.status).toBe(409);
  });
});

describe('an Express delivery', () => {
  let orderId = '';

  it('is offered to available drivers once paid, without customer details', async () => {
    orderId = await paidOrder(shop, hana, { type: 'express', pin: customerPin });

    expect(await statusOf(shop.shopId, orderId)).toBe('dispatching');
    const offer = lastTo(abebe.id);
    expect(offer?.text).toContain('New delivery job');
    // 40 + 12.50 × 5 km + 1.50 × 15 min = 125.
    expect(offer?.text).toContain('125.00 ብር');
    expect(offer?.text).not.toContain('Hana');
    expect(offer?.text).not.toContain('google.com/maps');
    const timer = await timerFor(OFFER_UNANSWERED_TIMER, offerIdFor(abebe.id));
    expect(timer?.dueAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });

  it('gives the accepting driver the customer name, phone, and pin', async () => {
    await bot.handleUpdate(tap(abebe, `job:accept:${offerIdFor(abebe.id)}`));

    expect(answers().at(-1)).toBe('The job is yours.');
    expect(await statusOf(shop.shopId, orderId)).toBe('assigned');
    const details = lastTo(abebe.id);
    expect(details?.text).toContain('Hana');
    expect(details?.text).toContain(`+25191${String(hana.id)}`);
    expect(details?.text).toContain('https://www.google.com/maps?q=8.9970566,38.7866129');
    expect(buttonsOf(details)[0]).toMatch(/^job:picked:/);
  });

  it('tells the customer who brings the order once it is picked up', async () => {
    const picked = buttonsOf(sentTo(abebe.id).at(-1))[0] ?? '';
    await bot.handleUpdate(tap(abebe, picked));

    expect(await statusOf(shop.shopId, orderId)).toBe('out_for_delivery');
    expect(lastTo(hana.id)?.text).toContain('Driver: Abebe · 📞 +251911000001');
    expect(buttonsOf(lastTo(abebe.id))[0]).toMatch(/^job:delivered:/);
  });

  it('asks for the location and delivers within 300 m of the pin', async () => {
    const delivered = buttonsOf(lastTo(abebe.id))[0] ?? '';
    await bot.handleUpdate(tap(abebe, delivered));
    expect(lastTo(abebe.id)?.payload.reply_markup).toMatchObject({
      keyboard: [[{ request_location: true }]],
    });

    const ownerMessages = sentTo(owner).length;
    await bot.handleUpdate(
      location(abebe, { ...customerPin, latitude: customerPin.latitude + 0.001 }),
    );

    expect(await statusOf(shop.shopId, orderId)).toBe('delivered');
    expect(lastTo(abebe.id)?.text).toContain('The job is complete');
    expect(sentTo(owner)).toHaveLength(ownerMessages);
    const { job, stop } = (await jobOf(shop.shopId, orderId)) ?? {};
    expect(job).toMatchObject({ status: 'delivered', payout: '125.00', estimatedMinutes: 15 });
    expect(job?.actualMinutes).toBe(0);
    expect(stop).toMatchObject({ needsReview: false, routingSeconds: 900, expectedSeconds: 900 });
    expect(stop?.metersFromPin).toBeLessThan(150);
    expect(await timerFor(RECEIPT_TIMER, orderId)).toBeDefined();
  });

  it('lets the customer confirm receipt once', async () => {
    expect(buttonsOf(lastTo(hana.id))).toEqual([
      `receipt:received:${orderId}`,
      `receipt:problem:${orderId}`,
    ]);
    await bot.handleUpdate(tap(hana, `receipt:received:${orderId}`));
    expect(lastTo(hana.id)?.text).toContain('Thank you for confirming');

    await bot.handleUpdate(tap(hana, `receipt:problem:${orderId}`));
    expect((await jobOf(shop.shopId, orderId))?.stop.receipt).toBe('received');
  });
});

describe('a delivery far from the pin', () => {
  it('still delivers, flags it for review, and counts silence as received', async () => {
    const sara = userOf(990202, 'Sara');
    const orderId = await paidOrder(shop, sara, { type: 'express', pin: customerPin });
    await bot.handleUpdate(tap(abebe, `job:accept:${offerIdFor(abebe.id)}`));
    await bot.handleUpdate(tap(abebe, buttonsOf(lastTo(abebe.id))[0] ?? ''));
    await bot.handleUpdate(tap(abebe, buttonsOf(lastTo(abebe.id))[0] ?? ''));
    await bot.handleUpdate(
      location(abebe, { ...customerPin, latitude: customerPin.latitude + 0.01 }),
    );

    expect(await statusOf(shop.shopId, orderId)).toBe('delivered');
    expect(lastTo(owner)?.text).toMatch(/marked delivered 1\d{3} m from the customer's pin/);
    expect(lastTo(owner)?.text).not.toContain(String(customerPin.latitude));
    expect((await jobOf(shop.shopId, orderId))?.stop.needsReview).toBe(true);

    const timer = await timerFor(RECEIPT_TIMER, orderId);
    if (!timer) throw new Error('No receipt timer');
    await trips.receiptTimeout(timer);
    expect((await jobOf(shop.shopId, orderId))?.stop.receipt).toBe('assumed');
  });

  it('publishes a problem report once, for the operations module to follow up', async () => {
    const meron = userOf(990203, 'Meron');
    const orderId = await paidOrder(shop, meron, { type: 'express', pin: customerPin });
    await bot.handleUpdate(tap(abebe, `job:accept:${offerIdFor(abebe.id)}`));
    await bot.handleUpdate(tap(abebe, buttonsOf(lastTo(abebe.id))[0] ?? ''));
    await bot.handleUpdate(tap(abebe, buttonsOf(lastTo(abebe.id))[0] ?? ''));
    await bot.handleUpdate(location(abebe, customerPin));
    const reports: { orderId: string }[] = [];
    events.subscribe('delivery.problem_reported', (event) => {
      reports.push(event);
      return Promise.resolve();
    });

    await bot.handleUpdate(tap(meron, `receipt:problem:${orderId}`));
    await bot.handleUpdate(tap(meron, `receipt:problem:${orderId}`));
    expect(reports).toEqual([{ shopId: shop.shopId, orderId }]);
    expect((await jobOf(shop.shopId, orderId))?.stop.receipt).toBe('problem');
  });
});

describe('a trip with a Live Location', () => {
  const live = (from: User, point: Coordinates, edit: boolean, livePeriod?: number): Update => {
    const message = {
      message_id: 500,
      date: Math.floor(liveNow.getTime() / 1000),
      chat: privateChat(from),
      from,
      location: livePeriod === undefined ? point : { ...point, live_period: livePeriod },
    };
    return edit
      ? { update_id: updateId++, edited_message: { ...message, edit_date: message.date } }
      : { update_id: updateId++, message };
  };
  const callsTo = (chatId: number, method: string) =>
    calls.filter((call) => call.method === method && call.chatId === chatId);
  const later = (ms: number) => {
    liveNow = new Date(liveNow.getTime() + ms);
  };

  async function onTheRoad(customer: User): Promise<string> {
    const orderId = await paidOrder(shop, customer, { type: 'express', pin: customerPin });
    await bot.handleUpdate(tap(abebe, `job:accept:${offerIdFor(abebe.id)}`));
    await bot.handleUpdate(tap(abebe, buttonsOf(lastTo(abebe.id))[0] ?? ''));
    return orderId;
  }

  it("asks the driver to share it, and moves a live map in the customer's chat", async () => {
    // Telegram dates are whole seconds, so a whole-second clock keeps the live period exact.
    liveNow = new Date(Math.floor(Date.now() / 1000) * 1000);
    const lily = userOf(990204, 'Lily');
    const orderId = await onTheRoad(lily);
    expect(sentTo(abebe.id).some((call) => call.text?.includes('Live Location'))).toBe(true);

    await bot.handleUpdate(live(abebe, shopPin, false, 3600));
    expect(lastTo(lily.id)?.text).toContain('live map');
    const [map] = callsTo(lily.id, 'sendLocation');
    expect(map?.payload).toMatchObject({ ...shopPin, live_period: 3600 });

    const moved = { latitude: 9.0, longitude: 38.77 };
    later(15_000);
    await bot.handleUpdate(live(abebe, moved, true, 3600));
    later(1_000);
    await bot.handleUpdate(live(abebe, customerPin, true, 3600));
    const edits = callsTo(lily.id, 'editMessageLiveLocation');
    expect(edits).toHaveLength(1);
    expect(edits[0]?.payload).toMatchObject(moved);

    await bot.handleUpdate(tap(abebe, buttonsOf(lastTo(abebe.id))[0] ?? ''));
    expect(await statusOf(shop.shopId, orderId)).toBe('delivered');
    expect(lastTo(abebe.id)?.text).toContain('The job is complete');
    expect(callsTo(lily.id, 'stopMessageLiveLocation')).toHaveLength(1);
    const { job } = (await jobOf(shop.shopId, orderId)) ?? {};
    expect(job).toMatchObject({ liveLatitude: null, liveAt: null });
  });

  it('asks for the location when the live point is stale, and ends maps when sharing stops', async () => {
    liveNow = new Date(Date.now() - 5 * 60_000);
    const yared = userOf(990205, 'Yared');
    const orderId = await onTheRoad(yared);
    await bot.handleUpdate(live(abebe, shopPin, false, 3600));
    const delivered = buttonsOf(lastTo(abebe.id))[0] ?? '';

    await bot.handleUpdate(tap(abebe, delivered));
    expect(lastTo(abebe.id)?.payload.reply_markup).toMatchObject({
      keyboard: [[{ request_location: true }]],
    });
    expect(await statusOf(shop.shopId, orderId)).toBe('out_for_delivery');

    await bot.handleUpdate(live(abebe, shopPin, true));
    expect(callsTo(yared.id, 'stopMessageLiveLocation')).toHaveLength(1);
    await bot.handleUpdate(location(abebe, customerPin));
    expect(await statusOf(shop.shopId, orderId)).toBe('delivered');
  });
});

describe('a pickup order', () => {
  it('is ready for pickup once paid, and the customer is told where', async () => {
    const dawit = userOf(990204, 'Dawit');
    const orderId = await paidOrder(shop, dawit, { type: 'pickup' });
    expect(await statusOf(shop.shopId, orderId)).toBe('ready_for_pickup');
    expect(lastTo(dawit.id)?.text).toContain('is ready for pickup at Shop');
    expect(lastTo(dawit.id)?.text).toContain('https://www.google.com/maps?q=9.0108,38.7613');
  });
});

describe('parallel accepts', () => {
  it('give the job to exactly one of ten drivers, and the others see "Taken"', async () => {
    const busyShop = await setUpShop(990003);
    const riders = Array.from({ length: 10 }, (_, i) =>
      userOf(990300 + i, `Rider${String(i)}`, `rider_${String(i)}`),
    );
    for (const rider of riders) await addDriver(busyShop.shopId, rider);
    const orderId = await paidOrder(busyShop, userOf(990205, 'Liya'), {
      type: 'express',
      pin: customerPin,
    });
    const offerId = offerIdFor(riders[0]?.id ?? 0);
    const before = calls.length;

    await Promise.all(riders.map((rider) => bot.handleUpdate(tap(rider, `job:accept:${offerId}`))));

    const replies = calls.slice(before).filter((c) => c.method === 'answerCallbackQuery');
    expect(replies.filter((c) => c.payload.text === 'The job is yours.')).toHaveLength(1);
    expect(
      replies.filter((c) => c.payload.text === 'Sorry, this job is no longer open.'),
    ).toHaveLength(9);
    const taken = calls
      .slice(before)
      .filter((c) => c.method === 'editMessageText' && c.text?.includes('Another driver took'));
    expect(taken).toHaveLength(9);
    expect(await statusOf(busyShop.shopId, orderId)).toBe('assigned');
  });
});

describe('the Saver run', () => {
  it('groups seven paid Saver orders into two routes and offers each as one job', async () => {
    const saverShop = await setUpShop(990005);
    const rider = userOf(990501, 'Yonas', 'yonas_saver');
    await addDriver(saverShop.shopId, rider);
    const directions = [10, 60, 110, 160, 210, 260, 310];
    const orderIds: string[] = [];
    for (const [index, degrees] of directions.entries()) {
      const radians = (degrees * Math.PI) / 180;
      const pin = {
        latitude: shopPin.latitude + Math.cos(radians) * 0.03,
        longitude: shopPin.longitude + Math.sin(radians) * 0.03,
      };
      const customer = userOf(990600 + index, `Customer${String(index)}`);
      orderIds.push(await paidOrder(saverShop, customer, { type: 'saver', pin }));
    }
    expect(await statusOf(saverShop.shopId, orderIds[0] ?? '')).toBe('paid');

    const response = await request(app).post('/jobs/saver-run').set('x-job-secret', jobSecret);

    expect(response.body).toEqual({ shops: 1, routes: 2, orders: 7, failed: 0 });
    const rows = await Promise.all(orderIds.map((id) => jobOf(saverShop.shopId, id)));
    const jobs = new Map(rows.map((row) => [row?.job.id, row?.job]));
    expect(jobs.size).toBe(2);
    const stopsPerJob = [...jobs.keys()].map((id) => rows.filter((r) => r?.job.id === id).length);
    expect(stopsPerJob.sort()).toEqual([3, 4]);
    for (const job of jobs.values()) {
      // One route pays less than separate trips to each of its stops.
      expect(Money.of(job?.payout ?? '0').compare(Money.of(job?.separateTripsPayout ?? '0'))).toBe(
        -1,
      );
    }
    for (const id of orderIds) expect(await statusOf(saverShop.shopId, id)).toBe('dispatching');
    expect(sentTo(rider.id).filter((c) => c.text?.includes('stops'))).toHaveLength(2);

    const again = await request(app).post('/jobs/saver-run').set('x-job-secret', jobSecret);
    expect(again.body).toEqual({ shops: 0, routes: 0, orders: 0, failed: 0 });
  });
});

describe("the owner's driver list", () => {
  it('shows what each driver is doing, from heading to the shop to carrying the order', async () => {
    const listShop = await setUpShop(990006);
    const rider = userOf(990701, 'Tsion', 'tsion_rides');
    await addDriver(listShop.shopId, rider);
    const workOf = async () => (await drivers.list(listShop.shopId))[0]?.work;
    expect(await workOf()).toBeNull();

    const orderId = await paidOrder(listShop, userOf(990702, 'Meron'), {
      type: 'express',
      pin: customerPin,
    });
    await bot.handleUpdate(tap(rider, `job:accept:${offerIdFor(rider.id)}`));
    const reference = orderReference(orderId);
    expect(await workOf()).toEqual({ stage: 'to_pickup', orderReference: reference });

    await bot.handleUpdate(tap(rider, buttonsOf(lastTo(rider.id))[0] ?? ''));
    expect(await workOf()).toEqual({ stage: 'delivering', orderReference: reference });
  });
});
