import { productInputSchema } from '@buchi/shared';
import { eq } from 'drizzle-orm';
import type { Update } from 'grammy/types';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { orders as ordersTable, productVariants, timers as timersTable } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { CheckoutService } from '../../src/modules/orders/checkout.service';
import { orderTimerKinds, PAYMENT_HOLD_MS } from '../../src/modules/orders/orders.deadlines.domain';
import {
  PaymentDeadlineService,
  type OrderNotifier,
} from '../../src/modules/orders/orders.deadlines.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { createReorderHandlers } from '../../src/modules/orders/orders.reorder.handlers';
import { reorderCallbackData } from '../../src/modules/orders/orders.schemas';
import { OrderService } from '../../src/modules/orders/orders.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { createBot } from '../../src/telegram/bot';
import { pickupOnlyDelivery } from '../fakes/pickup-only-delivery';
import { testDatabaseUrl } from './test-database';
import { noEmbeddings } from '../fakes/no-embeddings';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { StockHoldsRepo } from '../../src/modules/orders/stock-holds.repo';
import { noEvents } from '../fakes/no-events';
import { noPromotions } from '../fakes/no-owner-rules';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const logger = pino({ level: 'silent' });
const noTelegram = {
  verifyPostingRights: () => Promise.reject(new Error('unused')),
  publish: () => Promise.reject(new Error('unused')),
};
const shops = new ShopsService(db, new ShopsRepo(db), noTelegram);
const catalog = new CatalogService(
  db,
  new CatalogRepo(),
  shops,
  noTelegram,
  'bot',
  noEmbeddings,
  noEvents,
);
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const bus = new EventBus(logger);
const timers = new TimerService(new TimersRepo(db), logger);
const orders = new OrderService(
  db,
  new OrdersRepo(),
  bus,
  timers,
  new NegotiationService(db, new NegotiationsRepo()),
  noPromotions,
  new StockHoldsRepo(),
);
let now = new Date();
const checkout = new CheckoutService(customers, orders, shops, pickupOnlyDelivery, () => now);

/** Records what customers would be told, instead of calling Telegram. */
const told = { expiries: [] as { chatId: number; orderId: string }[] };
const notifier: OrderNotifier = {
  orderExpired: (chatId, orderId) => {
    told.expiries.push({ chatId, orderId });
    return Promise.resolve();
  },
};
const deadlines = new PaymentDeadlineService(orders, customers, notifier, () => now);
timers.register(orderTimerKinds.expire, (timer) => deadlines.expire(timer));

const buyer = { id: 515151, is_bot: false, first_name: 'Hana' };
const stranger = { id: 525252, is_bot: false, first_name: 'Dawit' };
let shopId = '';
let customerId = '';

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

async function variantWithStock(stock: number): Promise<string> {
  const product = await catalog.createProduct(
    shopId,
    productInputSchema.parse({ title: 'Nike Air', pricingMode: 'fixed', price: '1500' }),
  );
  await catalog.setVariants(shopId, product.id, [{ size: '42', color: null, stock }]);
  const [variant] =
    (await catalog.listProducts(shopId)).find((p) => p.id === product.id)?.variants ?? [];
  if (!variant) throw new Error('Variant missing');
  return variant.id;
}

const placeOrder = (variantId: string, paymentDeadline: Date, service = orders) =>
  service.create(
    shopId,
    {
      customerId,
      items: [{ variantId, quantity: 2 }],
      delivery: { type: 'pickup' },
      paymentDeadline,
    },
    'customer',
  );

const timersOf = (orderId: string) =>
  db
    .select({
      kind: timersTable.kind,
      shopId: timersTable.shopId,
      dueAt: timersTable.dueAt,
      status: timersTable.status,
    })
    .from(timersTable)
    .where(eq(timersTable.targetId, orderId))
    .orderBy(timersTable.dueAt);

const stockOf = (variantId: string) =>
  withShop(db, shopId, async (tx) => {
    const [row] = await tx
      .select({ stock: productVariants.stock, reserved: productVariants.reserved })
      .from(productVariants)
      .where(eq(productVariants.id, variantId));
    return row;
  });

const ordersOfCustomer = () =>
  withShop(db, shopId, (tx) =>
    tx.select().from(ordersTable).where(eq(ordersTable.customerId, customerId)),
  );

beforeAll(async () => {
  shopId = await shops.create(515100, { name: 'Deadline test shop' });
  customerId = (await customers.identify(shopId, buyer.id, 'Hana')).id;
});

beforeEach(async () => {
  await db.delete(timersTable);
  told.expiries.length = 0;
  now = new Date();
});

describe('scheduling payment deadlines', () => {
  it("holds a new order's stock for three minutes, with its expiry in the order's transaction", async () => {
    const variantId = await variantWithStock(2);
    const hana = { telegramUserId: buyer.id, name: buyer.first_name };
    await checkout.completeWithPhone(shopId, hana, '+251911515151', variantId);
    const order = await orders.latestUnpaid(shopId, buyer.id);
    if (!order) throw new Error('No order was placed');

    expect(PAYMENT_HOLD_MS).toBe(3 * 60_000);
    expect(order.paymentDeadline).toEqual(new Date(now.getTime() + PAYMENT_HOLD_MS));
    expect(await timersOf(order.id)).toEqual([
      { kind: 'order.expire', shopId, dueAt: order.paymentDeadline, status: 'pending' },
    ]);
    expect(await stockOf(variantId)).toEqual({ stock: 2, reserved: 1 });
    await orders.transition(shopId, order.id, 'cancelled', 'customer', 'Test cleanup');
  });

  it('leaves neither the order nor its timer when scheduling fails', async () => {
    const crashing = new OrderService(
      db,
      new OrdersRepo(),
      bus,
      { schedule: () => Promise.reject(new Error('Crashed while scheduling')) },
      new NegotiationService(db, new NegotiationsRepo()),
      noPromotions,
      new StockHoldsRepo(),
    );
    const variantId = await variantWithStock(2);
    const before = (await ordersOfCustomer()).length;

    await expect(placeOrder(variantId, minutesFromNow(3), crashing)).rejects.toThrow(
      'Crashed while scheduling',
    );

    expect(await db.select().from(timersTable)).toEqual([]);
    expect(await ordersOfCustomer()).toHaveLength(before);
    expect(await stockOf(variantId)).toEqual({ stock: 2, reserved: 0 });
  });
});

describe('payment deadline timers', () => {
  it('expires an unpaid order at its deadline, releases its stock, and offers a reorder', async () => {
    const variantId = await variantWithStock(2);
    const order = await placeOrder(variantId, minutesFromNow(-1));

    expect(await timers.tick()).toEqual({ requeued: 0, done: 1, failed: 0 });

    expect((await orders.get(shopId, order.id)).status).toBe('expired');
    expect(await stockOf(variantId)).toEqual({ stock: 2, reserved: 0 });
    expect(told.expiries).toEqual([{ chatId: buyer.id, orderId: order.id }]);
    expect(await timersOf(order.id)).toMatchObject([{ kind: 'order.expire', status: 'done' }]);
  });

  // A screenshot being checked or reviewed keeps the stock: the customer may well have paid.
  it.each([
    ['paid', ['payment_submitted', 'payment_approved'] as const, 0],
    ['cancelled', ['cancelled'] as const, 0],
    ['verifying', ['payment_submitted'] as const, 2],
    ['needs_review', ['payment_submitted', 'payment_unclear'] as const, 2],
  ])('leaves a %s order alone when its deadline passes', async (status, events, reserved) => {
    const variantId = await variantWithStock(2);
    const order = await placeOrder(variantId, minutesFromNow(-1));
    for (const event of events) {
      await orders.transition(shopId, order.id, event, 'system', 'Test setup');
    }

    expect(await timers.tick()).toEqual({ requeued: 0, done: 1, failed: 0 });

    expect((await orders.get(shopId, order.id)).status).toBe(status);
    expect((await stockOf(variantId))?.reserved).toBe(reserved);
    expect(told.expiries).toEqual([]);
    expect(await timersOf(order.id)).toMatchObject([{ status: 'done' }]);
  });
});

describe('Order again button', () => {
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
  const sent: string[] = [];
  const bot = createBot({
    token: 'test',
    botInfo,
    ownedShopIds: () => Promise.resolve([]),
    driverShopIds: () => Promise.resolve([]),
    handlers: [createReorderHandlers(checkout)],
  });
  bot.api.config.use((_prev, method, payload) => {
    if ('text' in payload && typeof payload.text === 'string') sent.push(payload.text);
    const result = method === 'sendMessage' ? { message_id: 1 } : true;
    return Promise.resolve({ ok: true, result } as never);
  });

  let updateId = 1;
  const tapOrderAgain = (from: typeof buyer, orderId: string): Update => ({
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from,
      chat_instance: '1',
      data: reorderCallbackData(orderId),
      message: {
        message_id: 1,
        date: 0,
        chat: { id: from.id, type: 'private', first_name: from.first_name },
        text: 'Your order expired',
      },
    },
  });

  async function expiredOrder(variantId: string) {
    const order = await placeOrder(variantId, minutesFromNow(-1));
    await timers.tick();
    return order;
  }

  it('places the expired order again with the same items for the same customer', async () => {
    const variantId = await variantWithStock(2);
    const expired = await expiredOrder(variantId);
    const before = new Set((await ordersOfCustomer()).map((o) => o.id));

    await bot.handleUpdate(tapOrderAgain(buyer, expired.id));

    expect(sent.at(-1)).toContain('is reserved for you');
    const placed = (await ordersOfCustomer()).filter((o) => !before.has(o.id));
    expect(placed).toHaveLength(1);
    const reorder = await orders.get(shopId, placed[0]?.id ?? '');
    expect(reorder).toMatchObject({ customerId, status: 'awaiting_payment', total: '3000.00' });
    expect(reorder.items).toMatchObject([{ variantId, quantity: 2 }]);
    expect(await stockOf(variantId)).toEqual({ stock: 2, reserved: 2 });
  });

  it("refuses another customer's order", async () => {
    const expired = await expiredOrder(await variantWithStock(2));
    const before = (await ordersOfCustomer()).length;

    await bot.handleUpdate(tapOrderAgain(stranger, expired.id));

    expect(sent.at(-1)).toContain('Order not found');
    expect(await ordersOfCustomer()).toHaveLength(before);
  });

  it('refuses an order that has not expired', async () => {
    const order = await placeOrder(await variantWithStock(2), minutesFromNow(3));

    await bot.handleUpdate(tapOrderAgain(buyer, order.id));

    expect(sent.at(-1)).toContain('Only an expired order can be ordered again');
  });

  it('says which item is out of stock', async () => {
    const variantId = await variantWithStock(2);
    const expired = await expiredOrder(variantId);
    await placeOrder(variantId, minutesFromNow(3));

    await bot.handleUpdate(tapOrderAgain(buyer, expired.id));

    expect(sent.at(-1)).toContain('Nike Air 42 is out of stock');
  });
});
