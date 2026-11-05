import { productInputSchema } from '@buchi/shared';
import { Api } from 'grammy';
import type { Chat, Update, User } from 'grammy/types';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { shopMembers } from '../../src/db/schema';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { buyLink } from '../../src/modules/catalog/catalog.domain';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { CheckoutService } from '../../src/modules/orders/checkout.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { createPurchaseHandlers } from '../../src/modules/orders/purchase.handlers';
import { createConversationHandlers } from '../../src/modules/owner/conversations.handlers';
import { ConversationsRepo } from '../../src/modules/owner/conversations.repo';
import {
  ConversationService,
  HAND_BACK_TIMER,
} from '../../src/modules/owner/conversations.service';
import { OrderAlerts } from '../../src/modules/owner/order-alerts.service';
import { OwnerNotifier } from '../../src/modules/owner/owner-notifier.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { createBot } from '../../src/telegram/bot';
import { TelegramMessenger } from '../../src/telegram/messenger';
import { pickupOnlyDelivery } from '../fakes/pickup-only-delivery';
import { testDatabaseUrl } from './test-database';

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

/** The clock that the services read. Timers fall due by the database clock, so tests start it in the past. */
let now = new Date();
const clock = () => now;

const telegram = {
  verifyPostingRights: () => Promise.resolve({ chatId: -1009876500002, title: 'Selam Shoes' }),
  publish: () => Promise.resolve(10),
};
const shops = new ShopsService(db, new ShopsRepo(db), telegram);
const catalog = new CatalogService(db, new CatalogRepo(), shops, telegram, botInfo.username);
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const events = new EventBus(logger);
const timers = new TimerService(new TimersRepo(db), logger);
const orders = new OrderService(db, new OrdersRepo(), events, timers);
const checkout = new CheckoutService(customers, orders, shops, pickupOnlyDelivery, clock);

interface SentMessage {
  method: string;
  chatId: number | string | undefined;
  text: string | undefined;
  messageId: number;
  payload: Record<string, unknown>;
}

/** Every call to Telegram, captured instead of sent. */
const calls: SentMessage[] = [];
let nextMessageId = 1000;
const fakeTelegram = (api: Api) => {
  api.config.use((_prev, method, payload) => {
    const fields: Record<string, unknown> = { ...payload };
    const text = fields.text ?? fields.caption;
    const messageId = nextMessageId++;
    calls.push({
      method,
      chatId: typeof fields.chat_id === 'number' ? fields.chat_id : undefined,
      text: typeof text === 'string' ? text : undefined,
      messageId,
      payload: fields,
    });
    const sends = ['sendMessage', 'sendPhoto', 'copyMessage'];
    return Promise.resolve({
      ok: true,
      result: sends.includes(method) ? { message_id: messageId } : true,
    } as never);
  });
};

const messengerApi = new Api('test');
fakeTelegram(messengerApi);
const messenger = new TelegramMessenger(messengerApi);
const conversationsRepo = new ConversationsRepo();
const notifier = new OwnerNotifier(db, conversationsRepo, shops, messenger, logger);
const conversations = new ConversationService(
  db,
  conversationsRepo,
  notifier,
  messenger,
  timers,
  clock,
);
timers.register(HAND_BACK_TIMER, (timer) => conversations.handBackIfSilent(timer));
const orderAlerts = new OrderAlerts(orders, conversations, notifier);
events.subscribe('order.created', (event) => orderAlerts.orderCreated(event));

const bot = createBot({
  token: 'test',
  botInfo,
  ownedShopIds: (telegramUserId) => shops.ownedShopIds(telegramUserId),
  driverShopIds: () => Promise.resolve([]),
  handlers: [
    createConversationHandlers({ conversations, customers }),
    createPurchaseHandlers({
      catalog,
      customers,
      checkout,
      conversations,
      locations: { fromText: () => Promise.resolve({ status: 'not_a_location' }) },
    }),
  ],
});
fakeTelegram(bot.api);

const ownerA1 = 880101;
const ownerA2 = 880102;
const ownerB = 880201;

const userOf = (id: number, name: string): User => ({ id, is_bot: false, first_name: name });
const privateChat = (user: User): Chat.PrivateChat => ({
  id: user.id,
  type: 'private',
  first_name: user.first_name,
});

let updateId = 1;
const message = (from: User, extra: Record<string, unknown>): Update => ({
  update_id: updateId++,
  message: { message_id: updateId, date: 0, chat: privateChat(from), from, ...extra },
});
const text = (from: User, body: string) => message(from, { text: body });
const start = (from: User, payload: string) =>
  message(from, {
    text: `/start ${payload}`,
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  });
const tap = (from: User, data: string): Update => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    from,
    chat_instance: '1',
    data,
    message: { message_id: 1, date: 0, chat: privateChat(from), text: 'card' },
  },
});
const replyTo = (owner: User, relayedMessageId: number, body: string) =>
  message(owner, {
    text: body,
    reply_to_message: { message_id: relayedMessageId, date: 0, chat: privateChat(owner) },
  });

const to = (chatId: number) => calls.filter((call) => call.chatId === chatId);
const lastTo = (chatId: number) => to(chatId).at(-1);
const callbackAnswers = () =>
  calls.filter((call) => call.method === 'answerCallbackQuery').map((call) => call.text);
const buttonDataOf = (call: SentMessage | undefined) =>
  JSON.stringify(call?.payload.reply_markup ?? null);

let shopA = '';
let fixedLink = '';
let negotiableLink = '';
let variantId = '';

async function startPayload(shopId: string, productId: string): Promise<string> {
  const { postId } = await catalog.postToChannel(shopId, productId);
  return buyLink(botInfo.username, postId).split('start=')[1] ?? '';
}

/** Starts a negotiable chat, which puts the customer in human mode, and returns its conversation. */
async function humanChatWith(customer: User) {
  await bot.handleUpdate(start(customer, negotiableLink));
  const conversation = await conversations.humanConversation(shopA, customer.id);
  if (!conversation) throw new Error('The price request did not start human mode');
  return conversation;
}

beforeAll(async () => {
  shopA = await shops.create(ownerA1, { name: 'Selam Shoes' });
  await db.insert(shopMembers).values({ shopId: shopA, telegramUserId: ownerA2 });
  await shops.setPaymentAccounts(shopA, [
    { provider: 'telebirr', accountName: 'Selam Tesfaye', accountNumber: '0911234567' },
  ]);
  await shops.connectChannel(shopA, '@selam_shoes_owner_test');
  await shops.create(ownerB, { name: 'Other Shop' });

  const fixed = await catalog.createProduct(
    shopA,
    productInputSchema.parse({ title: 'Nike Air Force 1', pricingMode: 'fixed', price: '4500' }),
  );
  await catalog.setVariants(shopA, fixed.id, [{ size: '42', color: null, stock: 10 }]);
  const negotiable = await catalog.createProduct(
    shopA,
    productInputSchema.parse({
      title: 'Leather Boots',
      pricingMode: 'negotiable',
      price: '6000',
      lowestPrice: '5000',
    }),
  );
  await catalog.setVariants(shopA, negotiable.id, [{ size: '40', color: null, stock: 2 }]);
  fixedLink = await startPayload(shopA, fixed.id);
  negotiableLink = await startPayload(shopA, negotiable.id);
  const products = await catalog.listProducts(shopA);
  variantId = products.find((p) => p.id === fixed.id)?.variants[0]?.id ?? '';
});

describe('owner alerts', () => {
  it('alerts every owner of the shop when an order is created', async () => {
    const hana = userOf(424201, 'Hana');
    await bot.handleUpdate(start(hana, fixedLink));
    await bot.handleUpdate(tap(hana, `buy:${variantId}`));
    await bot.handleUpdate(
      message(hana, {
        contact: { phone_number: '+251911000001', first_name: 'Hana', user_id: hana.id },
      }),
    );

    for (const owner of [ownerA1, ownerA2]) {
      const alert = lastTo(owner)?.text ?? '';
      expect(alert).toMatch(/New order #[0-9A-F]{6}/);
      expect(alert).toContain('💬 Hana · Selam Shoes');
      expect(alert).toContain('Nike Air Force 1 · መጠን / size 42');
      expect(alert).toContain('4,500.00 ብር');
      expect(alert).not.toContain('+251911000001');
      expect(buttonDataOf(lastTo(owner))).toContain('takeover:');
    }
    expect(to(ownerB)).toEqual([]);
  });

  it('asks the owners for the price of a negotiable product and stops Buchi', async () => {
    const abebe = userOf(424202, 'Abebe');
    await humanChatWith(abebe);

    expect(lastTo(abebe.id)?.text).toContain('The shop will send you the price here');
    for (const owner of [ownerA1, ownerA2]) {
      expect(lastTo(owner)?.text).toContain('Asks the price of Leather Boots');
      expect(buttonDataOf(lastTo(owner))).toContain('handback:');
    }
  });
});

describe('human mode', () => {
  it('relays customer messages to the owners and sends the customer nothing', async () => {
    const sara = userOf(424203, 'Sara');
    await humanChatWith(sara);
    const sentToSara = to(sara.id).length;

    await bot.handleUpdate(text(sara, 'ስንት ነው? How much?'));
    await bot.handleUpdate(tap(sara, `size:${variantId}`));
    await bot.handleUpdate(message(sara, { photo: [{ file_id: 'p1', file_unique_id: 'u1' }] }));

    expect(to(sara.id)).toHaveLength(sentToSara);
    for (const owner of [ownerA1, ownerA2]) {
      const [relayedText, relayedPhoto] = to(owner).slice(-2);
      expect(relayedText?.text).toBe('💬 Sara · Selam Shoes\nስንት ነው? How much?');
      expect(relayedPhoto).toMatchObject({ method: 'copyMessage', text: '💬 Sara · Selam Shoes' });
    }
  });

  it("delivers an owner's reply to the customer of the relayed message", async () => {
    const meron = userOf(424204, 'Meron');
    await humanChatWith(meron);
    await bot.handleUpdate(text(meron, 'Last price?'));
    const relayed = lastTo(ownerA2);

    await bot.handleUpdate(replyTo(userOf(ownerA2, 'Selam'), relayed?.messageId ?? 0, '5,800'));

    expect(lastTo(meron.id)).toMatchObject({
      method: 'copyMessage',
      payload: expect.objectContaining({ from_chat_id: ownerA2 }) as unknown,
    });
  });

  it('lets an owner hand back, after which Buchi answers again', async () => {
    const dawit = userOf(424205, 'Dawit');
    const conversation = await humanChatWith(dawit);

    await bot.handleUpdate(tap(userOf(ownerA1, 'Selam'), `handback:${conversation.id}`));
    await bot.handleUpdate(tap(dawit, `size:${variantId}`));

    expect(callbackAnswers()).toContain('Buchi is answering Dawit again.');
    expect(lastTo(dawit.id)?.text).toContain('size 42');
  });
});

describe('who can take over', () => {
  it('refuses Take over and Hand back from a customer or the owner of another shop', async () => {
    const liya = userOf(424206, 'Liya');
    const conversation = await humanChatWith(liya);
    const strangers = [userOf(ownerB, 'Other'), userOf(424299, 'Someone')];

    for (const stranger of strangers) {
      await bot.handleUpdate(tap(stranger, `handback:${conversation.id}`));
      await bot.handleUpdate(tap(stranger, `takeover:${conversation.id}`));
    }
    await bot.handleUpdate(tap(userOf(ownerB, 'Other'), 'handback:not-a-uuid'));

    expect(callbackAnswers().slice(-5)).toEqual(
      Array.from({ length: 5 }, () => "Only this shop's owners can do this."),
    );
    expect(await conversations.humanConversation(shopA, liya.id)).toBeDefined();
  });

  it("does not deliver another shop owner's reply to a relayed message", async () => {
    const tigist = userOf(424207, 'Tigist');
    await humanChatWith(tigist);
    await bot.handleUpdate(text(tigist, 'Hello?'));
    const sentToTigist = to(tigist.id).length;

    await bot.handleUpdate(replyTo(userOf(ownerB, 'Other'), lastTo(ownerA1)?.messageId ?? 0, 'Hi'));

    expect(to(tigist.id)).toHaveLength(sentToTigist);
  });
});

describe('automatic hand-back', () => {
  it('hands back after two hours of owner silence, and not before', async () => {
    const start = Date.now() - 3 * 60 * 60 * 1000;
    const at = (minutes: number) => new Date(start + minutes * 60 * 1000);
    const kebede = userOf(424208, 'Kebede');
    const owner = userOf(ownerA1, 'Selam');
    const conversation = await conversations.open(shopA, {
      telegramUserId: kebede.id,
      name: 'Kebede',
    });
    await customers.startSession(kebede.id, shopA);

    now = at(0);
    await bot.handleUpdate(tap(owner, `takeover:${conversation.id}`));
    now = at(60);
    await bot.handleUpdate(text(kebede, 'Are you there?'));
    await bot.handleUpdate(replyTo(owner, lastTo(ownerA1)?.messageId ?? 0, 'Yes'));

    now = at(121);
    await timers.tick();
    expect(await conversations.humanConversation(shopA, kebede.id)).toBeDefined();

    now = at(181);
    await timers.tick();
    expect(await conversations.humanConversation(shopA, kebede.id)).toBeUndefined();
    for (const ownerId of [ownerA1, ownerA2]) {
      expect(lastTo(ownerId)?.text).toContain('💬 Kebede · Selam Shoes\n🤖 No reply from you');
    }
  });
});
