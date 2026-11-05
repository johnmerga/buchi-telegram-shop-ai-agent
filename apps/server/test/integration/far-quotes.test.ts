import { Money, productInputSchema } from '@buchi/shared';
import type { FunctionCall } from '@google/genai';
import { and, eq, inArray } from 'drizzle-orm';
import { Api } from 'grammy';
import type { Chat, Update, User } from 'grammy/types';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FarPriceEstimator } from '../../src/ai/agents/far-price/far-price-estimator';
import { DecisionsRepo } from '../../src/ai/guard/decisions.repo';
import { PolicyGuard } from '../../src/ai/guard/policy-guard.service';
import { ToolRegistry } from '../../src/ai/registry';
import { AgentRuntime } from '../../src/ai/runtime';
import { TracesRepo } from '../../src/ai/traces.repo';
import { connectDatabase } from '../../src/db/client';
import {
  agentDecisions,
  deliveryJobs,
  farQuotes as farQuotesTable,
  jobOffers,
  jobStops,
  productVariants,
  timers,
} from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { AreaNotesRepo } from '../../src/modules/delivery/area-notes.repo';
import { AreaNoteService } from '../../src/modules/delivery/area-notes.service';
import { DeliverySettingsRepo } from '../../src/modules/delivery/delivery-settings.repo';
import { DeliveryService } from '../../src/modules/delivery/delivery.service';
import { straightLineMatrix } from '../../src/modules/delivery/distance.domain';
import { RouteService } from '../../src/modules/delivery/route.service';
import { ZoneFactorsRepo } from '../../src/modules/delivery/zone-factors.repo';
import { ZoneFactorService } from '../../src/modules/delivery/zone-factors.service';
import { DeliveryJobsRepo } from '../../src/modules/drivers/delivery-jobs.repo';
import { createDispatchHandlers } from '../../src/modules/drivers/dispatch.handlers';
import { DispatchService } from '../../src/modules/drivers/dispatch.service';
import { DriversRepo } from '../../src/modules/drivers/drivers.repo';
import { DriverService } from '../../src/modules/drivers/drivers.service';
import { JobOffers } from '../../src/modules/drivers/job-offers.service';
import { OfferBonusService } from '../../src/modules/drivers/offer-bonus.service';
import { DeliveryOwnerAlerts } from '../../src/modules/drivers/owner-alerts.service';
import { SpecialJobsRepo } from '../../src/modules/drivers/special-jobs.repo';
import {
  SPECIAL_OFFER_RAISE_TIMER,
  SpecialOffers,
} from '../../src/modules/drivers/special-offers.service';
import { AcceptanceFactorService } from '../../src/modules/far-quotes/acceptance-factors.service';
import { FarQuoteEvidence } from '../../src/modules/far-quotes/far-quote-evidence.service';
import { FarQuoteOutcomes } from '../../src/modules/far-quotes/far-quote-outcomes.service';
import { createFarQuoteHandlers } from '../../src/modules/far-quotes/far-quotes.handlers';
import { FarQuotesRepo } from '../../src/modules/far-quotes/far-quotes.repo';
import { FarQuoteService } from '../../src/modules/far-quotes/far-quotes.service';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { CheckoutService } from '../../src/modules/orders/checkout.service';
import { orderTimerKinds } from '../../src/modules/orders/orders.deadlines.domain';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { createPurchaseHandlers } from '../../src/modules/orders/purchase.handlers';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { EventBus } from '../../src/shared/events';
import { createBot } from '../../src/telegram/bot';
import { TelegramCustomerChat } from '../../src/telegram/customer-chat';
import { TelegramMessenger } from '../../src/telegram/messenger';
import { noEmbeddings } from '../fakes/no-embeddings';
import { ScriptedModel, type ScriptedTurn } from '../fakes/scripted-model';
import { testDatabaseUrl } from './test-database';
import { StockHoldsRepo } from '../../src/modules/orders/stock-holds.repo';
import { noEvents } from '../fakes/no-events';
import { noPauses, noPromotions } from '../fakes/no-owner-rules';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const logger = pino({ level: 'silent' });
const clock = () => new Date();
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

interface Call {
  method: string;
  chatId: number | undefined;
  text: string | undefined;
  payload: Record<string, unknown>;
}
const calls: Call[] = [];
let nextMessageId = 9000;
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
      result: method === 'sendMessage' ? { message_id: nextMessageId++ } : true,
    } as never);
  });
};
const telegramApi = new Api('test');
fakeTelegram(telegramApi);
const messenger = new TelegramMessenger(telegramApi);

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
/** Every road trip from the shop is 15 km and 30 minutes: inside the 20 km far range. */
const routing = { down: false };
const routes = new RouteService(
  {
    route: () =>
      routing.down
        ? Promise.reject(new Error('OpenRouteService is down'))
        : Promise.resolve({ meters: 15_000, seconds: 1800 }),
    matrix: (points) => Promise.resolve(straightLineMatrix(points)),
  },
  logger,
  clock,
);
const zoneFactors = new ZoneFactorService(new ZoneFactorsRepo(db), clock);
/** Other test files learn time factors in the same database, so payouts here use a fixed 1. */
const delivery = new DeliveryService(
  db,
  new DeliverySettingsRepo(),
  shops,
  routes,
  () => Promise.resolve(1),
  noPauses,
);
const checkout = new CheckoutService(customers, orders, shops, delivery, clock);

const driversRepo = new DriversRepo();
const jobsRepo = new DeliveryJobsRepo();
const drivers = new DriverService(db, driversRepo, shops, botInfo.username, clock);
const jobOffersService = new JobOffers(
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
const specialOffers = new SpecialOffers(
  db,
  jobsRepo,
  new SpecialJobsRepo(),
  driversRepo,
  jobOffersService,
  timerService,
  events,
  clock,
);
const dispatch = new DispatchService(
  db,
  jobsRepo,
  driversRepo,
  jobOffersService,
  specialOffers,
  orders,
  customers,
  shops,
  delivery,
  messenger,
  clock,
);

/** Each quote request sets the model's turns. */
let model = new ScriptedModel([]);
const guard = new PolicyGuard(db, new DecisionsRepo());
const farQuotesRepo = new FarQuotesRepo();
const acceptance = new AcceptanceFactorService(db, farQuotesRepo, clock);
const farQuotes = new FarQuoteService(
  db,
  farQuotesRepo,
  orders,
  customers,
  delivery,
  new FarQuoteEvidence(
    zoneFactors,
    acceptance,
    new AreaNoteService(db, new AreaNotesRepo(), clock),
    clock,
  ),
  new FarPriceEstimator(
    (tools) =>
      new AgentRuntime(model, new ToolRegistry(tools, guard, logger), db, new TracesRepo(), () =>
        performance.now(),
      ),
    guard,
    logger,
  ),
  guard,
  specialOffers,
  alerts,
  messenger,
  logger,
  clock,
);
const outcomes = new FarQuoteOutcomes(
  db,
  farQuotesRepo,
  orders,
  checkout,
  customers,
  specialOffers,
  messenger,
);
events.subscribe('order.transitioned', (event) => dispatch.orderTransitioned(event));
events.subscribe('order.transitioned', (event) => outcomes.orderTransitioned(event));
events.subscribe('delivery.offer_held', (event) => outcomes.driverHeld(event));

const bot = createBot({
  token: 'test',
  botInfo,
  ownedShopIds: (id) => shops.ownedShopIds(id),
  driverShopIds: (id) => drivers.shopIds(id),
  handlers: [
    createDispatchHandlers({
      dispatch,
      // The far-quote flow ends at assignment, before any trip button.
      trips: {} as never,
      specialOffers,
    }),
    createFarQuoteHandlers({ quotes: farQuotes, outcomes }),
    createPurchaseHandlers({
      catalog,
      customers,
      checkout,
      locations: { fromText: () => Promise.resolve({ status: 'not_a_location' }) },
      landmarks: { confirm: () => Promise.reject(new Error('unused')) },
      chat: new TelegramCustomerChat(telegramApi),
      farQuotes,
    }),
  ],
});
fakeTelegram(bot.api);

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
const tap = (from: User, data: string): Update => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    from,
    chat_instance: '1',
    data,
    message: { message_id: 1, date: 0, chat: privateChat(from), text: 'button' },
  },
});

const sentTo = (chatId: number) =>
  calls.filter((call) => call.method === 'sendMessage' && call.chatId === chatId);
const lastTo = (chatId: number) => sentTo(chatId).at(-1);
const answers = () =>
  calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.payload.text);
function buttonsOf(call: Call | undefined): string[] {
  const markup = call?.payload.reply_markup;
  if (typeof markup !== 'object' || markup === null || !('inline_keyboard' in markup)) return [];
  const rows = markup.inline_keyboard as { callback_data: string }[][];
  return rows.flat().map((button) => button.callback_data);
}
function holdButtonOf(driverId: number): string {
  const hold = buttonsOf(lastTo(driverId)).find((data) => data.startsWith('job:hold:'));
  if (!hold) throw new Error('The driver has no special offer');
  return hold;
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
/** 15 km and 30 minutes: 40 + 187.50 + 45. */
const formulaPayout = '272.50';
const shopPin = { latitude: 9.0108, longitude: 38.7613 };
const kality = { latitude: 8.9, longitude: 38.77 };

const owner = 880001;
const abebe = userOf(880101, 'Abebe', 'abebe_far');
const hana = userOf(880102, 'Hana', 'hana_far');
let shopId = '';
let variantId = '';
let nextCustomer = 880500;

beforeAll(async () => {
  shopId = await shops.create(owner, { name: 'Far Shoes' });
  await shops.setLocation(shopId, shopPin);
  await delivery.saveSettings(shopId, settings);
  const product = await catalog.createProduct(
    shopId,
    productInputSchema.parse({ title: 'Nike Air', pricingMode: 'fixed', price: '3500' }),
  );
  await catalog.setVariants(shopId, product.id, [{ size: '42', color: null, stock: 1000 }]);
  variantId = (await catalog.listProducts(shopId))[0]?.variants[0]?.id ?? '';
  for (const driver of [abebe, hana]) {
    const { link } = await drivers.invite(shopId, driver.username ?? '');
    const token = link.split('start=drv_')[1] ?? '';
    await drivers.link(token, {
      telegramUserId: driver.id,
      username: driver.username ?? '',
      name: driver.first_name,
    });
    await drivers.savePhone(driver.id, `+2519${String(driver.id)}`);
    await drivers.setAvailability(driver.id, true);
  }
});

const propose = (price: string, reason = 'Similar trips were accepted near this price.') => ({
  calls: [
    {
      id: 'call-1',
      name: 'propose_delivery_price',
      args: { price, reason, evidenceIds: ['formula', 'acceptance_factor'] },
    } satisfies FunctionCall,
  ],
});
const agentProposes = (price: string): ScriptedTurn[] => [propose(price), { text: 'Proposed.' }];

/** A customer with a phone and a far pin taps "ask the drivers", as the button flow does. */
async function requestQuote(
  turns: ScriptedTurn[],
  pin = kality,
): Promise<{ customer: User; orderId: string }> {
  model = new ScriptedModel(turns);
  const customer = userOf(nextCustomer++, 'Meron');
  const row = await customers.identify(shopId, customer.id, customer.first_name);
  await customers.setPhone(shopId, row.id, `+25191${String(customer.id)}`);
  await customers.setDeliveryPin(shopId, row.id, pin);
  await customers.startSession(customer.id, shopId, null);
  await customers.rememberChosenVariant(customer.id, variantId);
  await bot.handleUpdate(tap(customer, 'deliver:far'));
  const [order] = await orders.recentForCustomer(shopId, row.id, 1);
  if (!order) throw new Error('No quoting order');
  return { customer, orderId: order.id };
}

const quoteOf = async (orderId: string) => {
  const [row] = await withShop(db, shopId, (tx) =>
    tx.select().from(farQuotesTable).where(eq(farQuotesTable.orderId, orderId)),
  );
  return row;
};
const offersOf = (orderId: string) =>
  withShop(db, shopId, (tx) =>
    tx
      .select({ offer: jobOffers })
      .from(jobOffers)
      .innerJoin(jobStops, eq(jobStops.jobId, jobOffers.jobId))
      .where(eq(jobStops.orderId, orderId))
      .orderBy(jobOffers.raiseStep)
      .then((rows) => rows.map((row) => row.offer)),
  );
const jobOf = async (orderId: string) => {
  const [row] = await withShop(db, shopId, (tx) =>
    tx
      .select({ job: deliveryJobs })
      .from(deliveryJobs)
      .innerJoin(jobStops, eq(jobStops.jobId, deliveryJobs.id))
      .where(eq(jobStops.orderId, orderId)),
  );
  return row?.job;
};
const reserved = async () => {
  const [row] = await withShop(db, shopId, (tx) =>
    tx.select().from(productVariants).where(eq(productVariants.id, variantId)),
  );
  return row?.reserved;
};
const timerFor = async (kind: string, targetId: string) => {
  const [row] = await db
    .select()
    .from(timers)
    .where(and(eq(timers.kind, kind), eq(timers.targetId, targetId)));
  return row;
};
const statusOf = async (orderId: string) => (await orders.get(shopId, orderId)).status;

describe('a far-area quote', () => {
  let customer: User;
  let orderId = '';

  it('holds the stock for 20 minutes and offers the agent price under Special offers', async () => {
    const before = await reserved();
    ({ customer, orderId } = await requestQuote(agentProposes('480')));

    expect(sentTo(customer.id).at(-1)?.text).toContain('I am asking our drivers for a price');
    expect(await statusOf(orderId)).toBe('quoting');
    expect(await reserved()).toBe((before ?? 0) + 1);
    const hold = await timerFor(orderTimerKinds.quoteExpire, orderId);
    expect(hold?.dueAt.getTime()).toBeGreaterThan(Date.now() + 19 * 60_000);

    expect(await quoteOf(orderId)).toMatchObject({
      status: 'offered',
      source: 'agent',
      proposedPrice: '480.00',
      formulaPayout,
      cap: '1000.00',
    });
    expect(lastTo(abebe.id)?.text).toContain('Special offer · Far Shoes');
    expect(lastTo(abebe.id)?.text).toContain('480.00 ብር');
    expect(lastTo(hana.id)?.text).toContain('480.00 ብር');
    const [offer] = await offersOf(orderId);
    expect(await timerFor(SPECIAL_OFFER_RAISE_TIMER, offer?.id ?? '')).toBeDefined();
  });

  it('shows the model the evidence and records its guarded proposal', async () => {
    const text = JSON.stringify(model.requests[0]?.contents);
    expect(text).toContain(`Formula payout: ${formulaPayout}`);
    expect(text).toContain('15.0 km by road, about 30 min');
    const decisions = await withShop(db, shopId, (tx) =>
      tx.select().from(agentDecisions).where(eq(agentDecisions.tool, 'propose_delivery_price')),
    );
    expect(decisions.at(-1)).toMatchObject({
      result: 'accepted',
      agent: 'operations',
      limits: { formulaPayout, cap: '1000.00' },
    });
  });

  it('keeps a special offer from being taken like a paid job', async () => {
    const hold = holdButtonOf(abebe.id);
    await bot.handleUpdate(tap(abebe, hold.replace('job:hold:', 'job:accept:')));
    expect(answers().at(-1)).toBe('Sorry, this job is no longer open.');
    expect(await statusOf(orderId)).toBe('quoting');
  });

  it('never adds a bonus to a special offer, so only the cap rule raises it', async () => {
    const [offer] = await offersOf(orderId);
    const bonuses = new OfferBonusService(db, jobsRepo, jobOffersService);
    await expect(bonuses.raise(shopId, offer?.id ?? '', Money.of('50'))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await offersOf(orderId)).map((o) => o.status)).toEqual(['open']);
  });

  it('lets the first driver hold it and only then tells the customer the price', async () => {
    await bot.handleUpdate(tap(abebe, holdButtonOf(abebe.id)));

    expect(answers().at(-1)).toBe('You hold this job until the customer pays.');
    expect(await quoteOf(orderId)).toMatchObject({ status: 'held', heldPrice: '480.00' });
    const message = lastTo(customer.id);
    expect(message?.text).toContain('Delivery: 480.00 ብር');
    expect(message?.text).toContain('Total: 3,980.00 ብር');
    expect(buttonsOf(message)).toEqual([
      `farquote:confirm:${orderId}`,
      `farquote:decline:${orderId}`,
    ]);
    const edits = calls.filter((c) => c.method === 'editMessageText' && c.chatId === hana.id);
    expect(edits.at(-1)?.text).toContain('Another driver took this job');
  });

  it('sets the fee and the payment deadline when the customer confirms', async () => {
    await bot.handleUpdate(tap(customer, `farquote:confirm:${orderId}`));

    const order = await orders.get(shopId, orderId);
    expect(order).toMatchObject({
      status: 'awaiting_payment',
      deliveryType: 'far',
      deliveryFee: '480.00',
      total: '3980.00',
    });
    expect(order.paymentDeadline?.getTime()).toBeGreaterThan(Date.now() + 2.9 * 60 * 60_000);
    expect(lastTo(customer.id)?.text).toContain('Total: 3,980.00 ብር');
    expect(await quoteOf(orderId)).toMatchObject({ status: 'accepted' });
    expect(await timerFor(orderTimerKinds.expire, orderId)).toBeDefined();
  });

  it('gives the job to the driver who held it once the order is paid', async () => {
    await orders.transition(shopId, orderId, 'payment_submitted', 'customer', 'Screenshot');
    await orders.transition(shopId, orderId, 'payment_approved', 'system', 'Paid');

    expect(await statusOf(orderId)).toBe('assigned');
    expect(await jobOf(orderId)).toMatchObject({ status: 'assigned', payout: '480.00' });
    expect(lastTo(abebe.id)?.text).toContain('Meron');
    expect(buttonsOf(lastTo(abebe.id))[0]).toMatch(/^job:picked:/);
  });
});

describe('a far-area quote that ends without a delivery', () => {
  it('releases the stock and withdraws the offer when the 20-minute hold ends', async () => {
    const before = await reserved();
    const { customer, orderId } = await requestQuote(agentProposes('480'));

    await outcomes.holdExpired({ targetId: orderId, shopId });

    expect(await statusOf(orderId)).toBe('expired');
    expect(await reserved()).toBe(before);
    expect(await jobOf(orderId)).toBeUndefined();
    expect(await quoteOf(orderId)).toMatchObject({ status: 'expired', heldPrice: null });
    expect(lastTo(customer.id)?.text).toContain('No driver took the delivery within 20 minutes');
    expect(buttonsOf(lastTo(customer.id))).toEqual(['deliver:pickup']);
    const edits = calls.filter((c) => c.method === 'editMessageText' && c.chatId === hana.id);
    expect(edits.at(-1)?.text).toContain('withdrawn');
  });

  it('releases the stock and the holding driver when the customer declines', async () => {
    const before = await reserved();
    const { customer, orderId } = await requestQuote(agentProposes('500'));
    await bot.handleUpdate(tap(hana, holdButtonOf(hana.id)));

    await bot.handleUpdate(tap(customer, `farquote:decline:${orderId}`));

    expect(await statusOf(orderId)).toBe('cancelled');
    expect(await reserved()).toBe(before);
    expect(await jobOf(orderId)).toBeUndefined();
    expect(await quoteOf(orderId)).toMatchObject({ status: 'declined', heldPrice: '500.00' });
    const edits = calls.filter((c) => c.method === 'editMessageText' && c.chatId === hana.id);
    expect(edits.at(-1)?.text).toContain('withdrawn');
  });

  it('releases the holding driver when a confirmed order is not paid in time', async () => {
    const { customer, orderId } = await requestQuote(agentProposes('500'));
    await bot.handleUpdate(tap(hana, holdButtonOf(hana.id)));
    await bot.handleUpdate(tap(customer, `farquote:confirm:${orderId}`));

    await orders.transitionIfStill(
      shopId,
      orderId,
      'awaiting_payment',
      'expired',
      'system',
      'Late',
    );

    expect(await jobOf(orderId)).toBeUndefined();
    expect(await quoteOf(orderId)).toMatchObject({ status: 'accepted', heldPrice: '500.00' });
  });
});

describe('the statistical fallback', () => {
  it('prices the trip as formula payout × acceptance factor when the model fails', async () => {
    const { orderId } = await requestQuote([{ error: new Error('Gemini is down') }]);

    // No far trips are learned yet, so the factor is 1 and the payout rounds up to 280.
    expect(await quoteOf(orderId)).toMatchObject({
      status: 'offered',
      source: 'statistics',
      proposedPrice: '280.00',
    });
    expect((await offersOf(orderId))[0]?.price).toBe('280.00');
    const quote = await quoteOf(orderId);
    const [decision] = await withShop(db, shopId, (tx) =>
      tx
        .select()
        .from(agentDecisions)
        .where(eq(agentDecisions.id, quote?.decisionId ?? '')),
    );
    expect(decision).toMatchObject({ tool: 'statistical_estimate', result: 'accepted' });
  });

  it('falls back too when the model proposes no price', async () => {
    const { orderId } = await requestQuote([{ text: 'I cannot tell.' }]);
    expect(await quoteOf(orderId)).toMatchObject({ source: 'statistics', status: 'offered' });
  });
});

describe('raises', () => {
  it('raises an unaccepted offer by 10% every five minutes, stopping at the cap', async () => {
    const { orderId } = await requestQuote(agentProposes('880'));
    for (let step = 0; step < 3; step += 1) {
      const open = (await offersOf(orderId)).find((offer) => offer.status === 'open');
      await farQuotes.raiseDue({ targetId: open?.id ?? '', shopId });
    }
    const prices = (await offersOf(orderId)).map((offer) => offer.price);
    expect(prices).toEqual(['880.00', '970.00', '1000.00']);
    const last = (await offersOf(orderId)).at(-1);
    expect(await timerFor(SPECIAL_OFFER_RAISE_TIMER, last?.id ?? '')).toBeUndefined();
  });

  it('records the raises a held price took', async () => {
    const { orderId } = await requestQuote(agentProposes('400'));
    const [first] = await offersOf(orderId);
    await farQuotes.raiseDue({ targetId: first?.id ?? '', shopId });
    await bot.handleUpdate(tap(abebe, holdButtonOf(abebe.id)));
    expect(await quoteOf(orderId)).toMatchObject({ heldPrice: '440.00', raises: 1 });
  });
});

describe('a price above the cap', () => {
  it('reaches no driver until the owner approves it once, and then never rises', async () => {
    const { orderId } = await requestQuote(agentProposes('1200'));
    const quote = await quoteOf(orderId);
    expect(quote).toMatchObject({ status: 'awaiting_owner', proposedPrice: '1200.00' });
    expect(await offersOf(orderId)).toEqual([]);
    expect(lastTo(owner)?.text).toContain('above your cap of 1,000.00 ብር');
    expect(buttonsOf(lastTo(owner))).toEqual([
      `farquote:approve:${quote?.id ?? ''}`,
      `farquote:pickup:${quote?.id ?? ''}`,
    ]);

    await bot.handleUpdate(tap(userOf(owner, 'Owner'), `farquote:approve:${quote?.id ?? ''}`));

    const [offer] = await offersOf(orderId);
    expect(offer?.price).toBe('1200.00');
    expect(await timerFor(SPECIAL_OFFER_RAISE_TIMER, offer?.id ?? '')).toBeUndefined();
    const [decision] = await withShop(db, shopId, (tx) =>
      tx
        .select()
        .from(agentDecisions)
        .where(eq(agentDecisions.id, quote?.decisionId ?? '')),
    );
    expect(decision?.ownerStatus).toBe('approved');
  });

  it('cancels the quote and offers the customer pickup when the owner chooses pickup', async () => {
    const before = await reserved();
    const { customer, orderId } = await requestQuote(agentProposes('1500'));
    const quote = await quoteOf(orderId);

    await bot.handleUpdate(tap(userOf(owner, 'Owner'), `farquote:pickup:${quote?.id ?? ''}`));

    expect(await statusOf(orderId)).toBe('cancelled');
    expect(await reserved()).toBe(before);
    expect(await quoteOf(orderId)).toMatchObject({ status: 'pickup' });
    expect(lastTo(customer.id)?.text).toContain('cannot deliver');
    expect(await offersOf(orderId)).toEqual([]);
  });

  it('ignores the buttons of anyone but the owner', async () => {
    const { orderId } = await requestQuote(agentProposes('1300'));
    const quote = await quoteOf(orderId);
    await bot.handleUpdate(tap(abebe, `farquote:approve:${quote?.id ?? ''}`));
    expect(answers().at(-1)).toBe("Only this shop's owners can do this.");
    expect(await offersOf(orderId)).toEqual([]);
  });
});

describe('a route the routing service could not give', () => {
  it('prices the straight line × 1.4 and asks the owner even for a price within the cap', async () => {
    // Another zone than Kality's, whose road route is cached, and about 12 km in a straight line.
    const nearKality = { latitude: 8.91, longitude: 38.775 };
    routing.down = true;
    let quote: Awaited<ReturnType<typeof quoteOf>>;
    try {
      const { orderId } = await requestQuote(agentProposes('480'), nearKality);
      quote = await quoteOf(orderId);
      expect(await offersOf(orderId)).toEqual([]);
    } finally {
      routing.down = false;
    }

    expect(quote).toMatchObject({ status: 'awaiting_owner', proposedPrice: '480.00' });
    expect(quote?.routeMeters).toBeGreaterThan(15_000);
    expect(lastTo(owner)?.text).toContain('within your cap of 1,000.00 ብር');
    expect(lastTo(owner)?.text).toContain('the distance is a straight-line estimate');
    const [decision] = await withShop(db, shopId, (tx) =>
      tx
        .select()
        .from(agentDecisions)
        .where(eq(agentDecisions.id, quote?.decisionId ?? '')),
    );
    expect(decision).toMatchObject({ result: 'needs_owner', reason: 'approximate_route' });
  });
});

/** A small seeded generator, so a failing case can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe('the owner cap', () => {
  it('lets no offer above the cap reach a driver without an owner approval record', async () => {
    const next = random(55);
    const orderIds: string[] = [];
    for (let run = 0; run < 12; run += 1) {
      const cap = String(300 + Math.floor(next() * 900));
      await delivery.saveSettings(shopId, { ...settings, farCap: cap });
      const price = String(250 + Math.floor(next() * 1400));
      const turns: ScriptedTurn[] =
        next() < 0.2 ? [{ error: new Error('down') }] : agentProposes(price);
      const { orderId } = await requestQuote(turns);
      orderIds.push(orderId);
      const quote = await quoteOf(orderId);
      if (quote?.status === 'awaiting_owner' && next() < 0.6) {
        const answer = next() < 0.5 ? 'approve' : 'pickup';
        await bot.handleUpdate(tap(userOf(owner, 'Owner'), `farquote:${answer}:${quote.id}`));
      }
      for (let raise = Math.floor(next() * 5); raise > 0; raise -= 1) {
        const open = (await offersOf(orderId)).find((offer) => offer.status === 'open');
        if (open) await farQuotes.raiseDue({ targetId: open.id, shopId });
      }
    }
    await delivery.saveSettings(shopId, settings);

    const offers = await withShop(db, shopId, (tx) =>
      tx
        .select({
          price: jobOffers.price,
          cap: farQuotesTable.cap,
          owner: agentDecisions.ownerStatus,
        })
        .from(jobOffers)
        .innerJoin(jobStops, eq(jobStops.jobId, jobOffers.jobId))
        .innerJoin(farQuotesTable, eq(farQuotesTable.orderId, jobStops.orderId))
        .innerJoin(agentDecisions, eq(agentDecisions.id, farQuotesTable.decisionId))
        .where(inArray(jobStops.orderId, orderIds)),
    );
    expect(offers.length).toBeGreaterThan(12);
    for (const offer of offers) {
      const aboveCap = Money.of(offer.price).compare(Money.of(offer.cap)) > 0;
      expect(!aboveCap || offer.owner === 'approved', JSON.stringify(offer)).toBe(true);
    }
  });
});
