import { productInputSchema } from '@buchi/shared';
import type { Update } from 'grammy/types';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { buyLink } from '../../src/modules/catalog/catalog.domain';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { CheckoutService } from '../../src/modules/orders/checkout.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { createPurchaseHandlers } from '../../src/modules/orders/purchase.handlers';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { createBot } from '../../src/telegram/bot';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

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

const telegram = {
  verifyPostingRights: () => Promise.resolve({ chatId: -1009876500001, title: 'Selam Shoes' }),
  publish: () => Promise.resolve(10),
};
const shops = new ShopsService(db, new ShopsRepo(db), telegram);
const catalog = new CatalogService(db, new CatalogRepo(), shops, telegram, botInfo.username);
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const orders = new OrderService(db, new OrdersRepo(), new EventBus(pino({ level: 'silent' })));
const checkout = new CheckoutService(
  customers,
  orders,
  shops,
  () => new Date('2026-11-05T12:00:00Z'),
);

/** Every text the bot sends, captured instead of calling Telegram. */
const sent: string[] = [];
const bot = createBot({
  token: 'test',
  botInfo,
  ownedShopIds: () => Promise.resolve([]),
  handlers: [createPurchaseHandlers({ catalog, customers, checkout })],
});
bot.api.config.use((_prev, method, payload) => {
  if ('text' in payload && typeof payload.text === 'string') sent.push(payload.text);
  if ('caption' in payload && typeof payload.caption === 'string') sent.push(payload.caption);
  const result = method === 'sendMessage' || method === 'sendPhoto' ? { message_id: 1 } : true;
  return Promise.resolve({ ok: true, result } as never);
});

const customer = { id: 424242, is_bot: false, first_name: 'Hana' };
const chat = { id: customer.id, type: 'private' as const, first_name: 'Hana' };
let updateId = 1;

const message = (extra: Record<string, unknown>): Update => ({
  update_id: updateId++,
  message: { message_id: updateId, date: 0, chat, from: customer, ...extra },
});
const tap = (data: string): Update => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    from: customer,
    chat_instance: '1',
    data,
    message: { message_id: 1, date: 0, chat, text: 'card' },
  },
});

let startPayload = '';
let variantId = '';

beforeAll(async () => {
  const shopId = await shops.create(880001, { name: 'Selam Shoes' });
  await shops.setPaymentAccounts(shopId, [
    { provider: 'telebirr', accountName: 'Selam Tesfaye', accountNumber: '0911234567' },
  ]);
  await shops.connectChannel(shopId, '@selam_shoes_test');
  const product = await catalog.createProduct(
    shopId,
    productInputSchema.parse({ title: 'Nike Air Force 1', pricingMode: 'fixed', price: '4500' }),
  );
  await catalog.setVariants(shopId, product.id, [{ size: '42', color: null, stock: 1 }]);
  const { postId } = await catalog.postToChannel(shopId, product.id);
  startPayload = buyLink(botInfo.username, postId).split('start=')[1] ?? '';
  variantId = (await catalog.listProducts(shopId))[0]?.variants[0]?.id ?? '';
});

describe('purchase flow with buttons only', () => {
  it('goes from the Buy link to payment instructions, asking for the phone number once', async () => {
    const text = `/start ${startPayload}`;
    await bot.handleUpdate(
      message({ text, entities: [{ type: 'bot_command', offset: 0, length: 6 }] }),
    );
    expect(sent.at(-1)).toContain('4,500.00 ብር');

    await bot.handleUpdate(tap(`size:${variantId}`));
    expect(sent.at(-1)).toContain('size 42');

    await bot.handleUpdate(tap(`buy:${variantId}`));
    expect(sent.at(-1)).toContain('Share your phone number');

    await bot.handleUpdate(
      message({
        contact: { phone_number: '+251911000000', first_name: 'Hana', user_id: customer.id },
      }),
    );
    const instructions = sent.at(-1) ?? '';
    expect(instructions).toContain('4,500.00 ብር');
    expect(instructions).toContain('Telebirr: 0911234567');
    expect(instructions).toContain('5 Nov, 18:00');
  });

  it('tells the next customer that the last unit is gone', async () => {
    await bot.handleUpdate(tap(`buy:${variantId}`));
    expect(sent.at(-1)).toContain('out of stock');
  });

  it("ignores a contact that is not the customer's own", async () => {
    await bot.handleUpdate(
      message({ contact: { phone_number: '+251911999999', first_name: 'Other', user_id: 1 } }),
    );
    expect(sent.at(-1)).toContain('Share your own phone number');
  });
});
