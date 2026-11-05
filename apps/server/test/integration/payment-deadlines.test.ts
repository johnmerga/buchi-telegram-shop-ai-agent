import { productInputSchema, type MoneyString } from '@buchi/shared';
import { and, eq, sql } from 'drizzle-orm';
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
import { orderTimerKinds } from '../../src/modules/orders/orders.deadlines.domain';
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
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const logger = pino({ level: 'silent' });
const noTelegram = {
  verifyPostingRights: () => Promise.reject(new Error('unused')),
  publish: () => Promise.reject(new Error('unused')),
};
const shops = new ShopsService(db, new ShopsRepo(db), noTelegram);
const catalog = new CatalogService(db, new CatalogRepo(), shops, noTelegram, 'bot');
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const bus = new EventBus(logger);
const timers = new TimerService(new TimersRepo(db), logger);
const orders = new OrderService(db, new OrdersRepo(), bus, timers);
const checkout = new CheckoutService(customers, orders, shops, () => new Date());

/** Records what customers would be told, instead of calling Telegram. */
const told = {
  reminders: [] as { chatId: number; orderId: string; total: MoneyString; minutesLeft: number }[],
  expiries: [] as { chatId: number; orderId: string }[],
};
const notifier: OrderNotifier = {
  paymentReminder: (chatId, reminder) => {
    told.reminders.push({ chatId, ...reminder });
    return Promise.resolve();
  },
  orderExpired: (chatId, orderId) => {
    told.expiries.push({ chatId, orderId });
    return Promise.resolve();
  },
};
let now = new Date();
const deadlines = new PaymentDeadlineService(orders, customers, notifier, () => now);
timers.register(orderTimerKinds.paymentReminder, (timer) => deadlines.remind(timer));
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
    { customerId, items: [{ variantId, quantity: 2 }], deliveryType: 'pickup', paymentDeadline },
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

/** Moves a timer's due time to now, as if its hour had passed. */
const fastForward = (orderId: string, kind: string) =>
  db
    .update(timersTable)
    .set({ dueAt: sql`now()` })
    .where(and(eq(timersTable.targetId, orderId), eq(timersTable.kind, kind)));

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
  told.reminders.length = 0;
  told.expiries.length = 0;
  now = new Date();
});

describe('scheduling payment deadlines', () => {
  it("schedules the reminder and the expiry in the order's transaction", async () => {
    const deadline = minutesFromNow(180);
    const order = await placeOrder(await variantWithStock(2), deadline);

    expect(await timersOf(order.id)).toEqual([
      {
        kind: 'order.payment_reminder',
        shopId,
        dueAt: new Date(order.createdAt.getTime() + 3_600_000),
        status: 'pending',
      },
      { kind: 'order.expire', shopId, dueAt: deadline, status: 'pending' },
    ]);
  });

  it('leaves neither the order nor its timers when scheduling fails', async () => {
    let scheduled = 0;
    const crashing = new OrderService(db, new OrdersRepo(), bus, {
      schedule: (...args: Parameters<TimerService['schedule']>) =>
        scheduled++ > 0
          ? Promise.reject(new Error('Crashed before the second timer'))
          : timers.schedule(...args),
    });
    const variantId = await variantWithStock(2);
    const before = (await ordersOfCustomer()).length;

    await expect(placeOrder(variantId, minutesFromNow(180), crashing)).rejects.toThrow(
      'Crashed before the second timer',
    );

    expect(scheduled).toBe(2);
    expect(await db.select().from(timersTable)).toEqual([]);
    expect(await ordersOfCustomer()).toHaveLength(before);
    expect(await stockOf(variantId)).toEqual({ stock: 2, reserved: 0 });
  });
});

describe('payment deadline timers', () => {
  it('expires an unpaid order at its deadline, releases its stock, and offers a reorder', async () => {
    const variantId = await variantWithStock(2);
    const order = await placeOrder(variantId, minutesFromNow(-1));

    expect(await timers.tick()).toEqual({ done: 1, failed: 0 });

    expect((await orders.get(shopId, order.id)).status).toBe('expired');
    expect(await stockOf(variantId)).toEqual({ stock: 2, reserved: 0 });
    expect(told.expiries).toEqual([{ chatId: buyer.id, orderId: order.id }]);
    expect(await timersOf(order.id)).toMatchObject([{ kind: 'order.expire', status: 'done' }]);
  });

  it.each([
    ['paid', ['payment_submitted', 'payment_approved'] as const],
    ['cancelled', ['cancelled'] as const],
  ])('leaves a %s order alone when its deadline passes', async (status, events) => {
    const order = await placeOrder(await variantWithStock(2), minutesFromNow(-1));
    for (const event of events) {
      await orders.transition(shopId, order.id, event, 'system', 'Test setup');
    }

    expect(await timers.tick()).toEqual({ done: 1, failed: 0 });

    expect((await orders.get(shopId, order.id)).status).toBe(status);
    expect(told.expiries).toEqual([]);
    expect(await timersOf(order.id)).toMatchObject([{ status: 'done' }]);
  });

  it('reminds the customer with the time left while the order awaits payment', async () => {
    const deadline = minutesFromNow(180);
    const order = await placeOrder(await variantWithStock(2), deadline);
    await fastForward(order.id, 'order.payment_reminder');
    now = new Date(deadline.getTime() - 90 * 60_000);

    expect(await timers.tick()).toEqual({ done: 1, failed: 0 });

    expect(told.reminders).toEqual([
      { chatId: buyer.id, orderId: order.id, total: '3000.00', minutesLeft: 90 },
    ]);
  });

  it('sends no reminder once the customer has sent a payment', async () => {
    const order = await placeOrder(await variantWithStock(2), minutesFromNow(180));
    await orders.transition(shopId, order.id, 'payment_submitted', 'customer', 'Screenshot sent');
    await fastForward(order.id, 'order.payment_reminder');

    expect(await timers.tick()).toEqual({ done: 1, failed: 0 });

    expect(told.reminders).toEqual([]);
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
    const order = await placeOrder(await variantWithStock(2), minutesFromNow(180));

    await bot.handleUpdate(tapOrderAgain(buyer, order.id));

    expect(sent.at(-1)).toContain('Only an expired order can be ordered again');
  });

  it('says which item is out of stock', async () => {
    const variantId = await variantWithStock(2);
    const expired = await expiredOrder(variantId);
    await placeOrder(variantId, minutesFromNow(180));

    await bot.handleUpdate(tapOrderAgain(buyer, expired.id));

    expect(sent.at(-1)).toContain('Nike Air 42 is out of stock');
  });
});
