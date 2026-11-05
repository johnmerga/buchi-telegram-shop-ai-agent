import { Composer, Api } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { pino } from 'pino';
import { OperationsAgent } from '../../src/ai/agents/operations/operations-agent';
import {
  operationsApprovals,
  operationsTools,
} from '../../src/ai/agents/operations/operations-tools';
import { SituationBuilder } from '../../src/ai/agents/operations/situation-builder';
import { OwnerApprovals } from '../../src/ai/approvals/owner-approvals.service';
import { DecisionsRepo } from '../../src/ai/guard/decisions.repo';
import { PolicyGuard } from '../../src/ai/guard/policy-guard.service';
import type { LanguageModel } from '../../src/ai/language-model';
import { ToolRegistry } from '../../src/ai/registry';
import { AgentRuntime } from '../../src/ai/runtime';
import { TracesRepo } from '../../src/ai/traces.repo';
import type { Database } from '../../src/db/client';
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
import { DemandRepo } from '../../src/modules/demand/demand.repo';
import { DemandService } from '../../src/modules/demand/demand.service';
import { DeliveryJobsRepo } from '../../src/modules/drivers/delivery-jobs.repo';
import { createDispatchHandlers } from '../../src/modules/drivers/dispatch.handlers';
import { DispatchService } from '../../src/modules/drivers/dispatch.service';
import { DriversRepo } from '../../src/modules/drivers/drivers.repo';
import { DriverService } from '../../src/modules/drivers/drivers.service';
import { JobOffers, OFFER_UNANSWERED_TIMER } from '../../src/modules/drivers/job-offers.service';
import { OfferBonusService } from '../../src/modules/drivers/offer-bonus.service';
import { DeliveryOwnerAlerts } from '../../src/modules/drivers/owner-alerts.service';
import { TripDetails } from '../../src/modules/drivers/trip-details.service';
import { DELIVERY_LATE_TIMER, TripService } from '../../src/modules/drivers/trips.service';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { CustomerMessages } from '../../src/modules/operations/customer-messages.service';
import { CustomerProblems } from '../../src/modules/operations/customer-problems.service';
import { DeliveryProblemsRepo } from '../../src/modules/operations/delivery-problems.repo';
import { createOperationsHandlers } from '../../src/modules/operations/operations.handlers';
import { OperationsTriggers } from '../../src/modules/operations/operations-triggers.service';
import {
  DeliveryRescheduler,
  RESCHEDULE_TIMER,
} from '../../src/modules/operations/rescheduling.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { createApprovalHandlers } from '../../src/modules/owner/approvals.handlers';
import { createConversationHandlers } from '../../src/modules/owner/conversations.handlers';
import { ConversationsRepo } from '../../src/modules/owner/conversations.repo';
import { ConversationService } from '../../src/modules/owner/conversations.service';
import { OwnerAlerts } from '../../src/modules/owner/owner-alerts.service';
import { OwnerNotifier } from '../../src/modules/owner/owner-notifier.service';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import type { BuchiContext } from '../../src/telegram/actor';
import { createBot } from '../../src/telegram/bot';
import { TelegramMessenger } from '../../src/telegram/messenger';
import { noEmbeddings } from './no-embeddings';

export interface SentMessage {
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

/** What the sales agent would say. Here it only shows that a message passed the operations agent. */
export const SALES_REPLY = 'sales agent answered';

/**
 * The bot as `index.ts` wires it for operations: dispatch, owner approvals, takeover, the
 * operations agent on a given model, and a stand-in for the sales agent. Roads are 5 km and 15
 * minutes, and every Telegram call is captured instead of sent.
 */
export function createOperationsBot(db: Database, model: LanguageModel, now: () => Date) {
  const logger = pino({ level: 'silent' });
  const sent: SentMessage[] = [];
  let nextMessageId = 5000;
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
      const sends = ['sendMessage', 'copyMessage'];
      const result = sends.includes(method) ? { message_id: nextMessageId++ } : true;
      return Promise.resolve({ ok: true, result } as never);
    });
  };
  const api = new Api('test');
  capture(api);
  const messenger = new TelegramMessenger(api);

  const unused = () => Promise.reject(new Error('unused'));
  const shops = new ShopsService(db, new ShopsRepo(db), { verifyPostingRights: unused });
  const catalog = new CatalogService(
    db,
    new CatalogRepo(),
    shops,
    { publish: unused },
    botInfo.username,
    noEmbeddings,
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
  );
  const routes = new RouteService(
    {
      route: () => Promise.resolve({ meters: 5000, seconds: 900 }),
      matrix: (points) => Promise.resolve(straightLineMatrix(points)),
    },
    logger,
    now,
  );
  const delivery = new DeliveryService(db, new DeliverySettingsRepo(), shops, routes, () =>
    Promise.resolve(1),
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
  const driversRepo = new DriversRepo();
  const jobsRepo = new DeliveryJobsRepo();
  const drivers = new DriverService(db, driversRepo, shops, botInfo.username, now);
  const offers = new JobOffers(db, jobsRepo, driversRepo, shops, messenger, timers, logger, now);
  const dispatch = new DispatchService(
    db,
    jobsRepo,
    driversRepo,
    offers,
    orders,
    customers,
    shops,
    delivery,
    messenger,
    now,
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
    logger,
    now,
  );
  const tripDetails = new TripDetails(db, jobsRepo, driversRepo);
  const demand = new DemandService(db, new DemandRepo(), events);
  const areaNotes = new AreaNoteService(db, new AreaNotesRepo(), now);
  const ownerAlerts = new OwnerAlerts(shops, messenger, logger);
  const customerMessages = new CustomerMessages(orders, customers, conversations, messenger);
  const rescheduler = new DeliveryRescheduler(
    db,
    orders,
    customers,
    trips,
    conversations,
    customerMessages,
    messenger,
    timers,
    logger,
    now,
  );
  const decisions = new DecisionsRepo();
  const guard = new PolicyGuard(db, decisions);
  const toolDeps = {
    customerMessages,
    trips: tripDetails,
    messenger,
    now,
    rescheduler,
    orders,
    areaNotes,
    guard,
    catalog,
    ownerAlerts,
    customers,
    demand,
    bonuses: new OfferBonusService(db, jobsRepo, offers),
    conversations,
  };
  const tools = operationsTools(toolDeps);
  let monotonic = 0;
  const runtime = new AgentRuntime(
    model,
    new ToolRegistry(tools, guard, logger),
    db,
    new TracesRepo(),
    () => (monotonic += 10),
  );
  const approvals = new OwnerApprovals(
    db,
    decisions,
    operationsApprovals(tools, toolDeps),
    ownerAlerts,
    logger,
    now,
  );
  const agent = new OperationsAgent(runtime, approvals, ownerAlerts, logger, now);
  const situations = new SituationBuilder(orders, catalog, conversations, areaNotes, now);
  const triggers = new OperationsTriggers(
    agent,
    situations,
    orders,
    tripDetails,
    conversations,
    now,
  );
  const problems = new CustomerProblems(
    db,
    new DeliveryProblemsRepo(),
    orders,
    customers,
    catalog,
    messenger,
    conversations,
    situations,
    agent,
  );
  timers.register(OFFER_UNANSWERED_TIMER, (timer) => triggers.offerUnanswered(timer));
  timers.register(DELIVERY_LATE_TIMER, (timer) => triggers.deliveryLate(timer));
  timers.register(RESCHEDULE_TIMER, (timer) => rescheduler.rescheduleIfSilent(timer));
  events.subscribe('waitlist.joined', (event) => triggers.waitlistJoined(event));
  events.subscribe('delivery.problem_reported', (event) => problems.problemReported(event));

  const salesStandIn = new Composer<BuchiContext>();
  salesStandIn.on('message:text', (ctx) => ctx.reply(SALES_REPLY));

  const bot = createBot({
    token: 'test',
    botInfo,
    ownedShopIds: (id) => shops.ownedShopIds(id),
    driverShopIds: (id) => drivers.shopIds(id),
    handlers: [
      createDispatchHandlers({ dispatch, trips }),
      createApprovalHandlers(approvals),
      createConversationHandlers({ conversations, customers }),
      createOperationsHandlers({ triggers, problems, customers }),
      salesStandIn,
    ],
  });
  capture(bot.api);

  return {
    bot,
    sent,
    timers,
    services: { shops, catalog, customers, orders, delivery, drivers, demand, conversations },
  };
}
