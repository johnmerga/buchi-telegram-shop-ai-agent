import { productInputSchema } from '@buchi/shared';
import { Api } from 'grammy';
import type { Update } from 'grammy/types';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connectDatabase } from '../../src/db/client';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { buyLink } from '../../src/modules/catalog/catalog.domain';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { DeliverySettingsRepo } from '../../src/modules/delivery/delivery-settings.repo';
import { DeliveryService } from '../../src/modules/delivery/delivery.service';
import { LocationService } from '../../src/modules/delivery/location.service';
import { RouteService } from '../../src/modules/delivery/route.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { CheckoutService } from '../../src/modules/orders/checkout.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { createPurchaseHandlers } from '../../src/modules/orders/purchase.handlers';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { createBot } from '../../src/telegram/bot';
import { testDatabaseUrl } from './test-database';
import { noEmbeddings } from '../fakes/no-embeddings';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { TelegramCustomerChat } from '../../src/telegram/customer-chat';

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

let channelChatId = -1004242420001;
const telegram = {
  verifyPostingRights: () => Promise.resolve({ chatId: channelChatId--, title: 'Shoes' }),
  publish: () => Promise.resolve(10),
};
const shops = new ShopsService(db, new ShopsRepo(db), telegram);
const catalog = new CatalogService(
  db,
  new CatalogRepo(),
  shops,
  telegram,
  botInfo.username,
  noEmbeddings,
);
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const logger = pino({ level: 'silent' });
const orders = new OrderService(
  db,
  new OrdersRepo(),
  new EventBus(logger),
  new TimerService(new TimersRepo(db), logger),
  new NegotiationService(db, new NegotiationsRepo()),
);
/** The road trip that the fake routing service returns for every destination. */
const road = { meters: 5000, seconds: 900 };
const routes = new RouteService(
  { route: () => Promise.resolve(road), matrix: () => Promise.reject(new Error('unused')) },
  logger,
  () => new Date('2026-11-05T12:00:00Z'),
);
const delivery = new DeliveryService(db, new DeliverySettingsRepo(), shops, routes, () =>
  Promise.resolve(1),
);
const checkout = new CheckoutService(
  customers,
  orders,
  shops,
  delivery,
  () => new Date('2026-11-05T12:00:00Z'),
);
/** A short link whose redirect target is a place search without coordinates. */
const redirects = {
  target: () => Promise.resolve('https://www.google.com/maps/search/Edna+Mall+Bole'),
};

/** Every text the bot sends, and the inline buttons of the last message, instead of Telegram. */
const sent: string[] = [];
let buttons: string[] = [];
const captureSent = (api: Api) => {
  api.config.use((_prev, method, payload) => {
    if ('text' in payload && typeof payload.text === 'string') {
      sent.push(payload.text);
      buttons = inlineButtons(payload);
    }
    if ('caption' in payload && typeof payload.caption === 'string') sent.push(payload.caption);
    const result = method === 'sendMessage' || method === 'sendPhoto' ? { message_id: 1 } : true;
    return Promise.resolve({ ok: true, result } as never);
  });
};
const chatApi = new Api('test');
captureSent(chatApi);
const bot = createBot({
  token: 'test',
  botInfo,
  ownedShopIds: () => Promise.resolve([]),
  driverShopIds: () => Promise.resolve([]),
  handlers: [
    createPurchaseHandlers({
      catalog,
      customers,
      checkout,
      locations: new LocationService(redirects, logger),
      landmarks: { confirm: () => Promise.resolve() },
      chat: new TelegramCustomerChat(chatApi),
      farQuotes: { start: () => Promise.reject(new Error('unused')) },
    }),
  ],
});
captureSent(bot.api);

function inlineButtons(payload: object): string[] {
  const markup = z
    .object({
      reply_markup: z.object({ inline_keyboard: z.array(z.array(z.object({ text: z.string() }))) }),
    })
    .safeParse(payload);
  return markup.success ? markup.data.reply_markup.inline_keyboard.flat().map((b) => b.text) : [];
}

const hana = { id: 424242, is_bot: false, first_name: 'Hana' };
let updateId = 1;

const chatOf = (user: typeof hana) => ({
  id: user.id,
  type: 'private' as const,
  first_name: user.first_name,
});
const message = (extra: Record<string, unknown>, from = hana): Update => ({
  update_id: updateId++,
  message: { message_id: updateId, date: 0, chat: chatOf(from), from, ...extra },
});
const tap = (data: string, from = hana): Update => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    from,
    chat_instance: '1',
    data,
    message: { message_id: 1, date: 0, chat: chatOf(from), text: 'card' },
  },
});
const start = (payload: string, from = hana): Update =>
  message(
    { text: `/start ${payload}`, entities: [{ type: 'bot_command', offset: 0, length: 6 }] },
    from,
  );
const shareContact = (from: typeof hana): Update =>
  message(
    { contact: { phone_number: '+251911000000', first_name: from.first_name, user_id: from.id } },
    from,
  );

let startPayload = '';
let variantId = '';
let deliveryPayload = '';
let deliveryVariantId = '';

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

  const deliveringShopId = await shops.create(880002, { name: 'Abebe Shoes' });
  await shops.setPaymentAccounts(deliveringShopId, [
    { provider: 'telebirr', accountName: 'Abebe Kebede', accountNumber: '0922345678' },
  ]);
  await shops.connectChannel(deliveringShopId, '@abebe_shoes_test');
  await shops.setLocation(deliveringShopId, { latitude: 9.0105, longitude: 38.7613 });
  await delivery.saveSettings(deliveringShopId, {
    baseFee: '50',
    ratePerKm: '15',
    ratePerMinute: '2',
    freeRadiusKm: 3,
    standardRangeKm: 8,
    farRangeKm: 20,
    farCap: '1000',
    saverDiscountPercent: 20,
  });
  const boots = await catalog.createProduct(
    deliveringShopId,
    productInputSchema.parse({ title: 'Desert boots', pricingMode: 'fixed', price: '4500' }),
  );
  await catalog.setVariants(deliveringShopId, boots.id, [{ size: '41', color: null, stock: 5 }]);
  const bootsPost = await catalog.postToChannel(deliveringShopId, boots.id);
  deliveryPayload = buyLink(botInfo.username, bootsPost.postId).split('start=')[1] ?? '';
  deliveryVariantId = (await catalog.listProducts(deliveringShopId))[0]?.variants[0]?.id ?? '';
});

describe('purchase flow with buttons only', () => {
  it('goes from the Buy link to payment instructions, asking for the phone number once', async () => {
    await bot.handleUpdate(start(startPayload));
    expect(sent.at(-1)).toContain('4,500.00 ብር');

    await bot.handleUpdate(tap(`size:${variantId}`));
    expect(sent.at(-1)).toContain('size 42');

    await bot.handleUpdate(tap(`buy:${variantId}`));
    expect(sent.at(-1)).toContain('Share your phone number');

    await bot.handleUpdate(shareContact(hana));
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

describe('purchase flow with delivery', () => {
  const dawit = { id: 434343, is_bot: false, first_name: 'Dawit' };
  const meron = { id: 454545, is_bot: false, first_name: 'Meron' };

  /** Size, confirmation, and phone number, up to the question about the delivery location. */
  async function chooseSizeAndShareContact(from: typeof hana): Promise<void> {
    await bot.handleUpdate(start(deliveryPayload, from));
    await bot.handleUpdate(tap(`size:${deliveryVariantId}`, from));
    await bot.handleUpdate(tap(`buy:${deliveryVariantId}`, from));
    await bot.handleUpdate(shareContact(from));
    expect(sent.at(-1)).toContain('Where should we deliver?');
  }

  it('asks for a pin when a Maps link has no coordinates', async () => {
    await chooseSizeAndShareContact(dawit);
    await bot.handleUpdate(message({ text: 'https://maps.app.goo.gl/x7Y2abc' }, dawit));
    expect(sent.at(-1)).toContain('could not find a pin');
  });

  it('goes from the location to Express and a total with the delivery fee', async () => {
    road.meters = 5000;
    await bot.handleUpdate(message({ location: { latitude: 9.02, longitude: 38.79 } }, dawit));
    expect(sent.at(-1)).toContain('5.0 km by road, about 15 min');
    // 50 + 15 × 5 km + 2 × 15 min = 155 birr, so Express is 160 and Saver 20% less, 120.
    expect(buttons).toEqual([
      '🚚 ፈጣን / Express, today · 160.00 ብር',
      '🐢 ቁጠባ / Saver, next group run · 120.00 ብር',
      '🏪 ከሱቁ መውሰድ / Pickup at the shop',
    ]);

    await bot.handleUpdate(tap('deliver:express', dawit));
    const instructions = sent.at(-1) ?? '';
    expect(instructions).toContain('Items: 4,500.00 ብር');
    expect(instructions).toContain('Express delivery: 160.00 ብር');
    expect(instructions).toContain('Total: 4,660.00 ብር');
    expect(instructions).toContain('Telebirr: 0922345678');
  });

  it('takes the pin that the map picker Mini App sends back', async () => {
    road.meters = 5000;
    const selam = { id: 464646, is_bot: false, first_name: 'Selam' };
    await chooseSizeAndShareContact(selam);
    const fromMap = (data: string) =>
      message({ web_app_data: { button_text: 'Pick on the map', data } }, selam);

    await bot.handleUpdate(fromMap('{"latitude":"nine"}'));
    expect(sent.at(-1)).toContain('could not find a pin');

    await bot.handleUpdate(fromMap(JSON.stringify({ latitude: 9.02, longitude: 38.79 })));
    expect(sent.at(-1)).toContain('5.0 km by road');
    expect(buttons[0]).toBe('🚚 ፈጣን / Express, today · 160.00 ብር');
  });

  it('offers a driver price or pickup in the far range, and places a pickup order', async () => {
    road.meters = 15_000;
    await chooseSizeAndShareContact(meron);
    await bot.handleUpdate(message({ text: '9.10, 38.70' }, meron));
    expect(sent.at(-1)).toContain('I can ask our drivers for a price');
    expect(buttons).toEqual([
      '🛵 ዋጋ ጠይቅ / Yes, ask the drivers for a price',
      '🏪 ከሱቁ መውሰድ / Pickup at the shop',
    ]);

    await bot.handleUpdate(tap('deliver:pickup', meron));
    expect(sent.at(-1)).toContain('Total: 4,500.00 ብር\nPickup at the shop.');
  });
});
