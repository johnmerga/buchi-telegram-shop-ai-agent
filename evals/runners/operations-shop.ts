import { OperationsAgent } from '@buchi/server/ai/agents/operations/operations-agent';
import {
  operationsApprovals,
  operationsTools,
} from '@buchi/server/ai/agents/operations/operations-tools';
import { SituationBuilder } from '@buchi/server/ai/agents/operations/situation-builder';
import { OwnerApprovals } from '@buchi/server/ai/approvals/owner-approvals.service';
import { DecisionsRepo } from '@buchi/server/ai/guard/decisions.repo';
import { PolicyGuard } from '@buchi/server/ai/guard/policy-guard.service';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import { ToolRegistry } from '@buchi/server/ai/registry';
import { AgentRuntime } from '@buchi/server/ai/runtime';
import { TracesRepo } from '@buchi/server/ai/traces.repo';
import type { Database } from '@buchi/server/db/client';
import { CatalogRepo } from '@buchi/server/modules/catalog/catalog.repo';
import { CatalogService } from '@buchi/server/modules/catalog/catalog.service';
import { CustomersRepo } from '@buchi/server/modules/customers/customers.repo';
import { CustomersService } from '@buchi/server/modules/customers/customers.service';
import { SessionsRepo } from '@buchi/server/modules/customers/sessions.repo';
import { AreaNotesRepo } from '@buchi/server/modules/delivery/area-notes.repo';
import { AreaNoteService } from '@buchi/server/modules/delivery/area-notes.service';
import { DemandRepo } from '@buchi/server/modules/demand/demand.repo';
import { DemandService } from '@buchi/server/modules/demand/demand.service';
import { DeliveryJobsRepo } from '@buchi/server/modules/drivers/delivery-jobs.repo';
import { DriversRepo } from '@buchi/server/modules/drivers/drivers.repo';
import { JobOffers } from '@buchi/server/modules/drivers/job-offers.service';
import { OfferBonusService } from '@buchi/server/modules/drivers/offer-bonus.service';
import { DeliveryOwnerAlerts } from '@buchi/server/modules/drivers/owner-alerts.service';
import { TripDetails } from '@buchi/server/modules/drivers/trip-details.service';
import { TripService } from '@buchi/server/modules/drivers/trips.service';
import { TimersRepo } from '@buchi/server/modules/jobs/timers.repo';
import { TimerService } from '@buchi/server/modules/jobs/timers.service';
import { CustomerMessages } from '@buchi/server/modules/operations/customer-messages.service';
import { DeliveryRescheduler } from '@buchi/server/modules/operations/rescheduling.service';
import { OrdersRepo } from '@buchi/server/modules/orders/orders.repo';
import { OrderService } from '@buchi/server/modules/orders/orders.service';
import { ConversationsRepo } from '@buchi/server/modules/owner/conversations.repo';
import { ConversationService } from '@buchi/server/modules/owner/conversations.service';
import { OwnerAlerts } from '@buchi/server/modules/owner/owner-alerts.service';
import { OwnerNotifier } from '@buchi/server/modules/owner/owner-notifier.service';
import { NegotiationService } from '@buchi/server/modules/sales/negotiation.service';
import { NegotiationsRepo } from '@buchi/server/modules/sales/negotiations.repo';
import { ShopsRepo } from '@buchi/server/modules/shops/shops.repo';
import { ShopsService } from '@buchi/server/modules/shops/shops.service';
import { EventBus } from '@buchi/server/shared/events';
import { pino } from 'pino';

const offline = () => Promise.reject(new Error('Evaluations do not call Telegram'));

/**
 * The operations agent as the server wires it, on the evaluation database, with a fixed clock.
 * Telegram sends succeed without leaving the process, because the suite measures the agent's
 * actions and their autonomy levels, not delivery.
 */
export function createOperationsShop(db: Database, model: LanguageModel, now: () => Date) {
  const logger = pino({ level: 'silent' });
  let messageId = 0;
  const messenger = {
    send: () => Promise.resolve((messageId += 1)),
    copy: () => Promise.resolve((messageId += 1)),
    edit: () => Promise.resolve(),
  };
  const channels = { verifyPostingRights: offline, publish: offline };
  const shops = new ShopsService(db, new ShopsRepo(db), channels);
  const catalog = new CatalogService(db, new CatalogRepo(), shops, channels, 'evals_bot', {
    enqueue: () => Promise.resolve(),
  });
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
  const conversationsRepo = new ConversationsRepo();
  const conversations = new ConversationService(
    db,
    conversationsRepo,
    new OwnerNotifier(db, conversationsRepo, shops, messenger, logger),
    messenger,
    timers,
    now,
  );
  const jobs = new DeliveryJobsRepo();
  const drivers = new DriversRepo();
  const offers = new JobOffers(db, jobs, drivers, shops, messenger, timers, logger, now);
  const trips = new TripService(
    db,
    jobs,
    drivers,
    orders,
    customers,
    messenger,
    new DeliveryOwnerAlerts(shops, messenger, logger),
    events,
    timers,
    logger,
    now,
  );
  const tripDetails = new TripDetails(db, jobs, drivers);
  const areaNotes = new AreaNoteService(db, new AreaNotesRepo(), now);
  const ownerAlerts = new OwnerAlerts(shops, messenger, logger);
  const customerMessages = new CustomerMessages(orders, customers, conversations, messenger);
  const decisions = new DecisionsRepo();
  const guard = new PolicyGuard(db, decisions);
  const toolDeps = {
    customerMessages,
    trips: tripDetails,
    messenger,
    now,
    rescheduler: new DeliveryRescheduler(
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
    ),
    orders,
    areaNotes,
    guard,
    catalog,
    ownerAlerts,
    customers,
    demand: new DemandService(db, new DemandRepo(), events),
    bonuses: new OfferBonusService(db, jobs, offers),
    conversations,
  };
  const tools = operationsTools(toolDeps);
  const runtime = new AgentRuntime(
    model,
    new ToolRegistry(tools, guard, logger),
    db,
    new TracesRepo(),
    () => performance.now(),
  );
  const approvals = new OwnerApprovals(
    db,
    decisions,
    operationsApprovals(tools, toolDeps),
    ownerAlerts,
    logger,
    now,
  );
  return {
    agent: new OperationsAgent(runtime, approvals, ownerAlerts, logger, now),
    situations: new SituationBuilder(orders, catalog, conversations, areaNotes, now),
    trips: tripDetails,
    shops,
    customers,
  };
}
