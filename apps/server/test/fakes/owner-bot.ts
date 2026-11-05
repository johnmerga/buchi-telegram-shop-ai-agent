import { Api, Composer } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { pino } from 'pino';
import { OwnerAssistant } from '../../src/ai/agents/owner-assistant/owner-assistant';
import { ownerAssistantTools } from '../../src/ai/agents/owner-assistant/owner-assistant-tools';
import { weeklyAnalysisTool } from '../../src/ai/agents/owner-assistant/tools/weekly-analysis';
import { WeeklySuggestions } from '../../src/ai/agents/owner-assistant/weekly-suggestions';
import { OwnerApprovals } from '../../src/ai/approvals/owner-approvals.service';
import { DecisionsRepo } from '../../src/ai/guard/decisions.repo';
import { PolicyGuard } from '../../src/ai/guard/policy-guard.service';
import type { LanguageModel } from '../../src/ai/language-model';
import { ToolRegistry } from '../../src/ai/registry';
import { AgentRuntime } from '../../src/ai/runtime';
import type { Tool } from '../../src/ai/tool';
import { TracesRepo } from '../../src/ai/traces.repo';
import type { Database } from '../../src/db/client';
import { createCatalogHandlers } from '../../src/modules/catalog/catalog.handlers';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import {
  PRODUCT_EMBEDDING_TIMER,
  ProductEmbeddingService,
} from '../../src/modules/catalog/product-embeddings.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { DeliverySettingsRepo } from '../../src/modules/delivery/delivery-settings.repo';
import { DeliveryService } from '../../src/modules/delivery/delivery.service';
import { straightLineMatrix } from '../../src/modules/delivery/distance.domain';
import { RouteService } from '../../src/modules/delivery/route.service';
import { DemandRepo } from '../../src/modules/demand/demand.repo';
import { DemandService } from '../../src/modules/demand/demand.service';
import { WaitlistNotifier } from '../../src/modules/demand/waitlist-notifier.service';
import type { ChartConfig } from '../../src/modules/reporting/reporting.domain';
import { ReportingRepo } from '../../src/modules/reporting/reporting.repo';
import { ReportingService } from '../../src/modules/reporting/reporting.service';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { createListingHandlers } from '../../src/modules/listings/listings.handlers';
import { ListingsRepo } from '../../src/modules/listings/listings.repo';
import { ListingService } from '../../src/modules/listings/listings.service';
import { CustomerMessages } from '../../src/modules/operations/customer-messages.service';
import { orderTimerKinds } from '../../src/modules/orders/orders.deadlines.domain';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { StockHoldsRepo } from '../../src/modules/orders/stock-holds.repo';
import { createApprovalHandlers } from '../../src/modules/owner/approvals.handlers';
import { createAssistantHandlers } from '../../src/modules/owner/assistant.handlers';
import { createConversationHandlers } from '../../src/modules/owner/conversations.handlers';
import { ConversationsRepo } from '../../src/modules/owner/conversations.repo';
import { ConversationService } from '../../src/modules/owner/conversations.service';
import { OwnerAlerts } from '../../src/modules/owner/owner-alerts.service';
import { OwnerNotifier } from '../../src/modules/owner/owner-notifier.service';
import { OwnerRulesRepo } from '../../src/modules/rules/rules.repo';
import { OwnerRulesService } from '../../src/modules/rules/rules.service';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import type { BuchiContext } from '../../src/telegram/actor';
import { createBot } from '../../src/telegram/bot';
import { TelegramCustomerChat } from '../../src/telegram/customer-chat';
import { TelegramMessenger } from '../../src/telegram/messenger';
import type { SentMessage } from './operations-bot';

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

/** What the sales agent would say, to show that a message went past the owner's handlers. */
export const SALES_REPLY = 'sales agent answered';

/** The channel that `connectChannel` finds for every shop. */
export const CHANNEL_CHAT_ID = -1001234;

/** A captured Telegram call, with the message ID the fake gave a sent message. */
export interface OwnerBotMessage extends SentMessage {
  messageId: number | undefined;
}

/** A controllable clock for rules, holds, and the assistant's "today". */
export interface Clock {
  now: Date;
}

/**
 * The bot as `index.ts` wires Phase 7: owner rules in pricing and checkout, the owner assistant,
 * weekly suggestions, snap-to-list, and the restock waitlist. Roads are 5 km and 15 minutes, and
 * every Telegram call is captured instead of sent.
 */
export function createOwnerBot(db: Database, model: LanguageModel, clock: Clock) {
  const logger = pino({ level: 'silent' });
  const now = () => clock.now;
  const sent: OwnerBotMessage[] = [];
  let nextMessageId = 9000;
  const capture = (api: Api) => {
    api.config.use((_prev, method, payload) => {
      const fields: Record<string, unknown> = { ...payload };
      const text = fields.text ?? fields.caption;
      const sends = ['sendMessage', 'sendPhoto', 'copyMessage'];
      const messageId = sends.includes(method) ? nextMessageId++ : undefined;
      sent.push({
        method,
        chatId: typeof fields.chat_id === 'number' ? fields.chat_id : undefined,
        text: typeof text === 'string' ? text : undefined,
        payload: fields,
        messageId,
      });
      const chat = { id: fields.chat_id, type: 'private' };
      const result = messageId === undefined ? true : { message_id: messageId, date: 0, chat };
      // The fake answers every method with the fields the handlers read.
      return Promise.resolve({ ok: true, result } as never);
    });
  };
  const api = new Api('test');
  capture(api);
  const messenger = new TelegramMessenger(api);

  const posts: { chatId: number; caption: string }[] = [];
  const shops = new ShopsService(db, new ShopsRepo(db), {
    verifyPostingRights: () => Promise.resolve({ chatId: CHANNEL_CHAT_ID, title: 'Channel' }),
  });
  const timers = new TimerService(new TimersRepo(db), logger);
  const events = new EventBus(logger);
  const catalogRepo = new CatalogRepo();
  const embeddings = new ProductEmbeddingService(
    db,
    catalogRepo,
    model,
    timers,
    now,
    logger,
    events,
  );
  timers.register(PRODUCT_EMBEDDING_TIMER, (timer) => embeddings.embed(timer));
  const catalog = new CatalogService(
    db,
    catalogRepo,
    shops,
    {
      publish: (post) => {
        posts.push({ chatId: post.chatId, caption: post.caption });
        return Promise.resolve(posts.length);
      },
    },
    botInfo.username,
    embeddings,
    events,
  );
  const rules = new OwnerRulesService(db, new OwnerRulesRepo(), now);
  const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
  const orders = new OrderService(
    db,
    new OrdersRepo(),
    events,
    timers,
    new NegotiationService(db, new NegotiationsRepo()),
    rules,
    new StockHoldsRepo(),
  );
  const routes = new RouteService(
    {
      route: () => Promise.resolve({ meters: 5000, seconds: 900 }),
      matrix: (points) => Promise.resolve(straightLineMatrix(points)),
    },
    logger,
    now,
  );
  const delivery = new DeliveryService(
    db,
    new DeliverySettingsRepo(),
    shops,
    routes,
    () => Promise.resolve(1),
    rules,
  );
  const conversationsRepo = new ConversationsRepo();
  const notifier = new OwnerNotifier(db, conversationsRepo, shops, messenger, logger);
  const conversations = new ConversationService(
    db,
    conversationsRepo,
    notifier,
    messenger,
    timers,
    now,
  );
  const demand = new DemandService(db, new DemandRepo(), events);
  const customerMessages = new CustomerMessages(orders, customers, conversations, messenger);
  const waitlist = new WaitlistNotifier(
    demand,
    orders,
    catalog,
    customers,
    conversations,
    customerMessages,
    new TelegramCustomerChat(api),
    logger,
    now,
  );
  events.subscribe('variant.restocked', (event) => waitlist.variantRestocked(event));
  events.subscribe('product.embedded', (event) => waitlist.productEmbedded(event));
  timers.register(orderTimerKinds.holdExpire, (timer) => waitlist.holdExpired(timer));

  const reporting = new ReportingService(db, new ReportingRepo(db), now);
  const ownerAlerts = new OwnerAlerts(shops, messenger, logger);
  const decisions = new DecisionsRepo();
  const guard = new PolicyGuard(db, decisions);
  const ownerTools = ownerAssistantTools({ rules, delivery, catalog, reporting, now });
  const traces = new TracesRepo();
  let monotonic = 0;
  const runtimeWith = (tools: Tool[]) =>
    new AgentRuntime(model, new ToolRegistry(tools, guard, logger), db, traces, () => {
      monotonic += 10;
      return monotonic;
    });
  const runtime = runtimeWith(ownerTools.tools);
  const approvals = new OwnerApprovals(
    db,
    decisions,
    ownerTools.approvals,
    ownerAlerts,
    logger,
    now,
  );
  const charts: ChartConfig[] = [];
  const chartOutage = { active: false };
  const assistant = new OwnerAssistant(
    runtime,
    approvals,
    {
      render: (chart) => {
        if (chartOutage.active) return Promise.reject(new Error('QuickChart is down'));
        charts.push(chart);
        return Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      },
    },
    logger,
    now,
  );
  const weekly = new WeeklySuggestions(
    runtimeWith([weeklyAnalysisTool({ reporting, delivery })]),
    reporting,
    guard,
    approvals,
    ownerAlerts,
    logger,
    now,
  );
  const listings = new ListingService(
    db,
    new ListingsRepo(),
    model,
    { download: () => Promise.resolve('aGVsbG8=') },
    catalog,
    logger,
  );

  const salesStandIn = new Composer<BuchiContext>();
  salesStandIn.on('message:text', (ctx) => ctx.reply(SALES_REPLY));

  const bot = createBot({
    token: 'test',
    botInfo,
    ownedShopIds: (id) => shops.ownedShopIds(id),
    driverShopIds: () => Promise.resolve([]),
    handlers: [
      createApprovalHandlers(approvals),
      createConversationHandlers({ conversations, customers }),
      createListingHandlers(listings),
      createCatalogHandlers(catalog),
      createAssistantHandlers({ assistant, customers }),
      salesStandIn,
    ],
  });
  capture(bot.api);

  return {
    bot,
    sent,
    charts,
    chartOutage,
    posts,
    timers,
    services: {
      shops,
      catalog,
      customers,
      orders,
      delivery,
      demand,
      rules,
      reporting,
      weekly,
      listings,
      conversations,
    },
  };
}
