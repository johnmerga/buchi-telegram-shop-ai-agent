import { SalesAgent } from '@buchi/server/ai/agents/sales/sales-agent';
import { SalesContext } from '@buchi/server/ai/agents/sales/sales-context';
import { salesTools } from '@buchi/server/ai/agents/sales/sales-tools';
import { DecisionsRepo } from '@buchi/server/ai/guard/decisions.repo';
import { PolicyGuard } from '@buchi/server/ai/guard/policy-guard.service';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import { ToolRegistry } from '@buchi/server/ai/registry';
import { AgentRuntime } from '@buchi/server/ai/runtime';
import { TracesRepo } from '@buchi/server/ai/traces.repo';
import type { Database } from '@buchi/server/db/client';
import { CatalogRepo } from '@buchi/server/modules/catalog/catalog.repo';
import { CatalogService } from '@buchi/server/modules/catalog/catalog.service';
import { CustomerFactsRepo } from '@buchi/server/modules/customers/customer-facts.repo';
import { CustomerMemoryService } from '@buchi/server/modules/customers/customer-memory.service';
import { CustomersRepo } from '@buchi/server/modules/customers/customers.repo';
import { CustomersService } from '@buchi/server/modules/customers/customers.service';
import { SessionsRepo } from '@buchi/server/modules/customers/sessions.repo';
import { LandmarksRepo } from '@buchi/server/modules/delivery/landmarks.repo';
import { LandmarkService } from '@buchi/server/modules/delivery/landmarks.service';
import { DemandRepo } from '@buchi/server/modules/demand/demand.repo';
import { DemandService } from '@buchi/server/modules/demand/demand.service';
import { TimersRepo } from '@buchi/server/modules/jobs/timers.repo';
import { TimerService } from '@buchi/server/modules/jobs/timers.service';
import { CheckoutService } from '@buchi/server/modules/orders/checkout.service';
import { OrdersRepo } from '@buchi/server/modules/orders/orders.repo';
import { OrderService } from '@buchi/server/modules/orders/orders.service';
import { ConversationsRepo } from '@buchi/server/modules/owner/conversations.repo';
import { ConversationService } from '@buchi/server/modules/owner/conversations.service';
import { OwnerNotifier } from '@buchi/server/modules/owner/owner-notifier.service';
import { NegotiationService } from '@buchi/server/modules/sales/negotiation.service';
import { NegotiationsRepo } from '@buchi/server/modules/sales/negotiations.repo';
import { PriceEvidenceService } from '@buchi/server/modules/sales/price-evidence.service';
import { ShopsRepo } from '@buchi/server/modules/shops/shops.repo';
import { ShopsService } from '@buchi/server/modules/shops/shops.service';
import { EventBus } from '@buchi/server/shared/events';
import { pino } from 'pino';
import { StockHoldsRepo } from '@buchi/server/modules/orders/stock-holds.repo';

const offline = () => Promise.reject(new Error('Evaluations do not call Telegram'));

/**
 * The sales agent as the server wires it, on the evaluation database. Telegram, the geocoder,
 * and delivery pricing are stubs, because the suites measure the agent and its guard.
 */
export function createSalesShop(db: Database, model: LanguageModel, now: () => Date) {
  const logger = pino({ level: 'silent' });
  const channels = { verifyPostingRights: offline, publish: offline };
  const shops = new ShopsService(db, new ShopsRepo(db), channels);
  const catalog = new CatalogService(
    db,
    new CatalogRepo(),
    shops,
    channels,
    'evals_bot',
    {
      enqueue: () => Promise.resolve(),
    },
    { publish: () => Promise.resolve() },
  );
  const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
  const timers = new TimerService(new TimersRepo(db), logger);
  const negotiations = new NegotiationService(db, new NegotiationsRepo());
  const orders = new OrderService(
    db,
    new OrdersRepo(),
    new EventBus(logger),
    timers,
    negotiations,
    { activePromotions: () => Promise.resolve([]) },
    new StockHoldsRepo(),
  );
  const pickupOnly = {
    offersDelivery: () => Promise.resolve(false),
    quote: () => Promise.resolve(undefined),
  };
  const checkout = new CheckoutService(customers, orders, shops, pickupOnly, now);
  // Owner alerts are recorded by message ID, so each fake message needs its own.
  let messageId = 0;
  const messenger = {
    send: () => Promise.resolve((messageId += 1)),
    copy: () => Promise.resolve((messageId += 1)),
    edit: () => Promise.resolve(),
  };
  const conversationsRepo = new ConversationsRepo();
  const conversations = new ConversationService(
    db,
    conversationsRepo,
    new OwnerNotifier(db, conversationsRepo, shops, messenger, logger),
    messenger,
    timers,
    now,
  );
  const memory = new CustomerMemoryService(db, new CustomerFactsRepo());
  const guard = new PolicyGuard(db, new DecisionsRepo());
  const silentChat = {
    orderStep: () => Promise.resolve(),
    confirmPlace: () => Promise.resolve(),
    askForPin: () => Promise.resolve(),
  };
  const tools = salesTools({
    catalog,
    customers,
    orders,
    checkout,
    chat: silentChat,
    evidence: new PriceEvidenceService(customers, orders, negotiations, now),
    demand: new DemandService(db, new DemandRepo(), new EventBus(logger)),
    negotiations,
    guard,
    landmarks: new LandmarkService(
      db,
      new LandmarksRepo(),
      { search: () => Promise.resolve(undefined) },
      logger,
    ),
    memory,
    conversations,
  });
  const runtime = new AgentRuntime(
    model,
    new ToolRegistry(tools, guard, logger),
    db,
    new TracesRepo(),
    () => performance.now(),
  );
  const agent = new SalesAgent(
    runtime,
    new SalesContext(catalog, customers, orders, memory),
    customers,
    conversations,
    memory,
    logger,
  );
  return { agent, shops, catalog, customers, orders };
}
