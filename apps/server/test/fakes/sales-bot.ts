import { Api } from 'grammy';
import type { Chat, Update, User, UserFromGetMe } from 'grammy/types';
import { pino } from 'pino';
import { SalesAgent } from '../../src/ai/agents/sales/sales-agent';
import { SalesContext } from '../../src/ai/agents/sales/sales-context';
import { salesTools } from '../../src/ai/agents/sales/sales-tools';
import { DecisionsRepo } from '../../src/ai/guard/decisions.repo';
import { PolicyGuard } from '../../src/ai/guard/policy-guard.service';
import type { LanguageModel } from '../../src/ai/language-model';
import { ToolRegistry } from '../../src/ai/registry';
import { AgentRuntime } from '../../src/ai/runtime';
import { TracesRepo } from '../../src/ai/traces.repo';
import type { Database } from '../../src/db/client';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomerFactsRepo } from '../../src/modules/customers/customer-facts.repo';
import { CustomerMemoryService } from '../../src/modules/customers/customer-memory.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { LandmarksRepo } from '../../src/modules/delivery/landmarks.repo';
import { LandmarkService, type Geocoder } from '../../src/modules/delivery/landmarks.service';
import { DemandRepo } from '../../src/modules/demand/demand.repo';
import { DemandService } from '../../src/modules/demand/demand.service';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { CheckoutService } from '../../src/modules/orders/checkout.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { createPurchaseHandlers } from '../../src/modules/orders/purchase.handlers';
import { createConversationHandlers } from '../../src/modules/owner/conversations.handlers';
import { ConversationsRepo } from '../../src/modules/owner/conversations.repo';
import { ConversationService } from '../../src/modules/owner/conversations.service';
import { OwnerNotifier } from '../../src/modules/owner/owner-notifier.service';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { PriceEvidenceService } from '../../src/modules/sales/price-evidence.service';
import { createSalesHandlers } from '../../src/modules/sales/sales.handlers';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { createBot } from '../../src/telegram/bot';
import { TelegramCustomerChat } from '../../src/telegram/customer-chat';
import { TelegramMessenger } from '../../src/telegram/messenger';
import { noEmbeddings } from './no-embeddings';
import { pickupOnlyDelivery } from './pickup-only-delivery';

interface SentMessage {
  method: string;
  chatId: number | undefined;
  text: string | undefined;
  payload: Record<string, unknown>;
}

const botInfo: UserFromGetMe = {
  id: 1,
  is_bot: true,
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

/**
 * The customer side of the bot as `index.ts` wires it, with the sales agent on a given model,
 * pickup-only delivery, a fixed geocoder, and every Telegram call captured instead of sent.
 */
export function createSalesBot(db: Database, model: LanguageModel, geocoder: Geocoder) {
  const logger = pino({ level: 'silent' });
  const sent: SentMessage[] = [];
  let nextMessageId = 1000;
  const capture = (api: Api) => {
    api.config.use((_prev, method, payload) => {
      const fields: Record<string, unknown> = { ...payload };
      const text = fields.text ?? fields.caption;
      sent.push({
        method,
        chatId: typeof fields.chat_id === 'number' ? fields.chat_id : undefined,
        text: typeof text === 'string' ? text : undefined,
        payload: fields,
      });
      const sends = ['sendMessage', 'sendPhoto', 'sendVenue', 'copyMessage'];
      const result = sends.includes(method) ? { message_id: nextMessageId++ } : true;
      return Promise.resolve({ ok: true, result } as never);
    });
  };
  const api = new Api('test');
  capture(api);

  const telegram = {
    verifyPostingRights: () => Promise.resolve({ chatId: -1007000000001, title: 'Shop' }),
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
  const timers = new TimerService(new TimersRepo(db), logger);
  const negotiations = new NegotiationService(db, new NegotiationsRepo());
  const orders = new OrderService(db, new OrdersRepo(), new EventBus(logger), timers, negotiations);
  const checkout = new CheckoutService(
    customers,
    orders,
    shops,
    pickupOnlyDelivery,
    () => new Date(),
  );
  const messenger = new TelegramMessenger(api);
  const conversationsRepo = new ConversationsRepo();
  const conversations = new ConversationService(
    db,
    conversationsRepo,
    new OwnerNotifier(db, conversationsRepo, shops, messenger, logger),
    messenger,
    timers,
    () => new Date(),
  );
  const landmarks = new LandmarkService(db, new LandmarksRepo(), geocoder, logger);
  const memory = new CustomerMemoryService(db, new CustomerFactsRepo());
  const demand = new DemandService(db, new DemandRepo());
  const chat = new TelegramCustomerChat(api);
  const guard = new PolicyGuard(db, new DecisionsRepo());
  const registry = new ToolRegistry(
    salesTools({
      catalog,
      customers,
      orders,
      checkout,
      chat,
      evidence: new PriceEvidenceService(customers, orders, negotiations, () => new Date()),
      demand,
      negotiations,
      guard,
      landmarks,
      memory,
      conversations,
    }),
    guard,
    logger,
  );
  let now = 0;
  const runtime = new AgentRuntime(model, registry, db, new TracesRepo(), () => (now += 10));
  const agent = new SalesAgent(
    runtime,
    new SalesContext(catalog, customers, orders, memory),
    customers,
    conversations,
    memory,
    logger,
  );

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
        locations: { fromText: () => Promise.resolve({ status: 'not_a_location' }) },
        landmarks,
        chat,
      }),
      createSalesHandlers({ agent, customers }),
    ],
  });
  capture(bot.api);

  return {
    bot,
    agent,
    sent,
    services: { shops, catalog, customers, orders, conversations, landmarks, memory },
  };
}

let updateId = 1;
const privateChat = (user: User): Chat.PrivateChat => ({
  id: user.id,
  type: 'private',
  first_name: user.first_name,
});

export const userOf = (id: number, name: string): User => ({ id, is_bot: false, first_name: name });

const message = (from: User, extra: Record<string, unknown>): Update => ({
  update_id: updateId++,
  message: { message_id: updateId, date: 0, chat: privateChat(from), from, ...extra },
});

export const text = (from: User, body: string): Update => message(from, { text: body });

export const start = (from: User, payload: string): Update =>
  message(from, {
    text: `/start ${payload}`,
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  });

export const tap = (from: User, data: string, extra: Record<string, unknown> = {}): Update => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    from,
    chat_instance: '1',
    data,
    message: { message_id: 1, date: 0, chat: privateChat(from), text: 'card', ...extra },
  },
});

export const shareContact = (from: User): Update =>
  message(from, {
    contact: {
      phone_number: `+25191${String(from.id)}`,
      first_name: from.first_name,
      user_id: from.id,
    },
  });
