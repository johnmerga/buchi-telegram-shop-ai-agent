import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { GoogleGenAI } from '@google/genai';
import { Api } from 'grammy';
import { OperationsAgent } from './ai/agents/operations/operations-agent';
import { operationsApprovals, operationsTools } from './ai/agents/operations/operations-tools';
import { SituationBuilder } from './ai/agents/operations/situation-builder';
import { OwnerApprovals } from './ai/approvals/owner-approvals.service';
import { SalesAgent } from './ai/agents/sales/sales-agent';
import { SalesContext } from './ai/agents/sales/sales-context';
import { salesTools } from './ai/agents/sales/sales-tools';
import { GeminiModel } from './ai/gemini';
import { DecisionsRepo } from './ai/guard/decisions.repo';
import { PolicyGuard } from './ai/guard/policy-guard.service';
import { QuotaManager } from './ai/quota';
import { ToolRegistry } from './ai/registry';
import { AgentRuntime } from './ai/runtime';
import { TracesRepo } from './ai/traces.repo';
import { loadEnv } from './config/env';
import { createLogger } from './config/logger';
import { connectDatabase } from './db/client';
import { PRODUCT_EMBEDDING_DIMENSIONS } from './db/schema';
import { createApp } from './http/app';
import { requireAuth } from './http/middleware/require-auth';
import { requireShopOwner } from './http/middleware/require-shop-owner';
import { createCatalogHandlers } from './modules/catalog/catalog.handlers';
import { CatalogRepo } from './modules/catalog/catalog.repo';
import { createCatalogRouter } from './modules/catalog/catalog.routes';
import { CatalogService } from './modules/catalog/catalog.service';
import { PhotoSearchService } from './modules/catalog/photo-search.service';
import {
  PRODUCT_EMBEDDING_TIMER,
  ProductEmbeddingService,
} from './modules/catalog/product-embeddings.service';
import { createAuthRouter } from './modules/auth/auth.routes';
import { AuthService } from './modules/auth/auth.service';
import { Nominatim } from './integrations/nominatim';
import { HttpRedirects } from './integrations/redirects';
import { OpenRouteService } from './integrations/ors';
import { AreaNotesRepo } from './modules/delivery/area-notes.repo';
import { AreaNoteService } from './modules/delivery/area-notes.service';
import { DeliverySettingsRepo } from './modules/delivery/delivery-settings.repo';
import { createDeliveryRouter } from './modules/delivery/delivery.routes';
import { DeliveryService } from './modules/delivery/delivery.service';
import { LandmarksRepo } from './modules/delivery/landmarks.repo';
import { LandmarkService } from './modules/delivery/landmarks.service';
import { LocationService } from './modules/delivery/location.service';
import { RouteService } from './modules/delivery/route.service';
import { SaverScheduleService, SAVER_RUN_TIMER } from './modules/delivery/saver-schedule.service';
import { DeliveryJobsRepo } from './modules/drivers/delivery-jobs.repo';
import { createDispatchHandlers } from './modules/drivers/dispatch.handlers';
import { DispatchService } from './modules/drivers/dispatch.service';
import { createDriverHandlers } from './modules/drivers/drivers.handlers';
import { DriversRepo } from './modules/drivers/drivers.repo';
import { createDriversRouter } from './modules/drivers/drivers.routes';
import { DriverService } from './modules/drivers/drivers.service';
import { JobOffers, OFFER_UNANSWERED_TIMER } from './modules/drivers/job-offers.service';
import { OfferBonusService } from './modules/drivers/offer-bonus.service';
import { DeliveryOwnerAlerts } from './modules/drivers/owner-alerts.service';
import { SaverRunService } from './modules/drivers/saver-runs.service';
import { TripDetails } from './modules/drivers/trip-details.service';
import { DELIVERY_LATE_TIMER, RECEIPT_TIMER, TripService } from './modules/drivers/trips.service';
import { CustomerMessages } from './modules/operations/customer-messages.service';
import { CustomerProblems } from './modules/operations/customer-problems.service';
import { DeliveryProblemsRepo } from './modules/operations/delivery-problems.repo';
import { createOperationsHandlers } from './modules/operations/operations.handlers';
import { OperationsTriggers } from './modules/operations/operations-triggers.service';
import { DeliveryRescheduler, RESCHEDULE_TIMER } from './modules/operations/rescheduling.service';
import { createJobsRouter } from './modules/jobs/jobs.routes';
import { JobService, type Job } from './modules/jobs/jobs.service';
import { TimersRepo } from './modules/jobs/timers.repo';
import { TimerService } from './modules/jobs/timers.service';
import { ShopsRepo } from './modules/shops/shops.repo';
import { CustomerFactsRepo } from './modules/customers/customer-facts.repo';
import { CustomerMemoryService } from './modules/customers/customer-memory.service';
import { CustomersRepo } from './modules/customers/customers.repo';
import { CustomersService } from './modules/customers/customers.service';
import { SessionsRepo } from './modules/customers/sessions.repo';
import { CheckoutService } from './modules/orders/checkout.service';
import { orderTimerKinds } from './modules/orders/orders.deadlines.domain';
import { PaymentDeadlineService } from './modules/orders/orders.deadlines.service';
import { OrdersRepo } from './modules/orders/orders.repo';
import { OrderService } from './modules/orders/orders.service';
import { createReorderHandlers } from './modules/orders/orders.reorder.handlers';
import { createPurchaseHandlers } from './modules/orders/purchase.handlers';
import { ImageIntake } from './modules/payments/image-intake.service';
import { PaymentNotifier } from './modules/payments/payment-notifier.service';
import { PaymentProofsRepo } from './modules/payments/payment-proofs.repo';
import { PaymentRefsRepo } from './modules/payments/payment-refs.repo';
import { PaymentReview } from './modules/payments/payment-review.service';
import { PaymentVerification } from './modules/payments/payment-verification.service';
import { createPaymentHandlers } from './modules/payments/payments.handlers';
import { ReceiptReader } from './modules/payments/receipt-reader.service';
import { RiskSignalsRepo } from './modules/payments/risk-signals.repo';
import { RiskService } from './modules/payments/risk.service';
import { createApprovalHandlers } from './modules/owner/approvals.handlers';
import { createConversationHandlers } from './modules/owner/conversations.handlers';
import { ConversationsRepo } from './modules/owner/conversations.repo';
import { ConversationService, HAND_BACK_TIMER } from './modules/owner/conversations.service';
import { OrderAlerts } from './modules/owner/order-alerts.service';
import { OwnerAlerts } from './modules/owner/owner-alerts.service';
import { OwnerNotifier } from './modules/owner/owner-notifier.service';
import { createDemandHandlers } from './modules/demand/demand.handlers';
import { DemandRepo } from './modules/demand/demand.repo';
import { DemandService } from './modules/demand/demand.service';
import { NegotiationService } from './modules/sales/negotiation.service';
import { NegotiationsRepo } from './modules/sales/negotiations.repo';
import { PriceEvidenceService } from './modules/sales/price-evidence.service';
import { createSalesHandlers } from './modules/sales/sales.handlers';
import { createShopsRouter } from './modules/shops/shops.routes';
import { ShopsService } from './modules/shops/shops.service';
import { TelegramChannels } from './telegram/channels';
import { EventBus } from './shared/events';
import { BankReceipts } from './integrations/receipts/bank-receipts';
import { CbeReceipts } from './integrations/receipts/cbe';
import { timedFetch } from './integrations/receipts/fetch-page';
import { TelebirrReceipts } from './integrations/receipts/telebirr';
import { createBot } from './telegram/bot';
import { TelegramCustomerChat } from './telegram/customer-chat';
import { TelegramFiles } from './telegram/files';
import { TelegramMessenger } from './telegram/messenger';
import { TelegramIngress } from './telegram/ingress';
import { TelegramOrderNotifier } from './telegram/order-notifier';
import { TelegramUpdatesRepo } from './telegram/updates.repo';
import { createTelegramWebhookRouter } from './telegram/webhook.routes';
import { UpdateWorker } from './telegram/worker';

const SHUTDOWN_TIMEOUT_MS = 10_000;
/** Bank receipt pages are optional evidence, so a slow page must not hold up a customer's reply. */
const RECEIPT_PAGE_TIMEOUT_MS = 8_000;

const env = loadEnv(process.env);
const logger = createLogger(env);
const database = connectDatabase(env.DATABASE_URL);

const timers = new TimerService(new TimersRepo(database.db), logger);

const telegramApi = new Api(env.TELEGRAM_BOT_TOKEN);
const botInfo = await telegramApi.getMe();
const channels = new TelegramChannels(telegramApi, botInfo.id);

const shops = new ShopsService(database.db, new ShopsRepo(database.db), channels);
const model = new GeminiModel(
  new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }).models,
  {
    models: {
      fast: env.GEMINI_MODEL_FAST,
      smart: env.GEMINI_MODEL_SMART,
      embedding: env.GEMINI_MODEL_EMBED,
    },
    embeddingDimensions: PRODUCT_EMBEDDING_DIMENSIONS,
  },
  new QuotaManager(
    {
      requestsPerMinute: env.GEMINI_REQUESTS_PER_MINUTE,
      requestsPerDay: env.GEMINI_REQUESTS_PER_DAY,
    },
    () => new Date(),
  ),
);
const catalogRepo = new CatalogRepo();
const embeddings = new ProductEmbeddingService(
  database.db,
  catalogRepo,
  model,
  timers,
  () => new Date(),
  logger,
);
timers.register(PRODUCT_EMBEDDING_TIMER, (timer) => embeddings.embed(timer));
const catalog = new CatalogService(
  database.db,
  catalogRepo,
  shops,
  channels,
  botInfo.username,
  embeddings,
);

const events = new EventBus(logger);
const customers = new CustomersService(
  database.db,
  new CustomersRepo(),
  new SessionsRepo(database.db),
);
const negotiations = new NegotiationService(database.db, new NegotiationsRepo());
const orders = new OrderService(database.db, new OrdersRepo(), events, timers, negotiations);
const routes = new RouteService(
  new OpenRouteService({ baseUrl: env.ORS_BASE_URL, apiKey: env.ORS_API_KEY }, fetch),
  logger,
  () => new Date(),
);
// TODO(5.5): use the learned zone time factors.
const deliverySettings = new DeliverySettingsRepo();
const delivery = new DeliveryService(database.db, deliverySettings, shops, routes, () =>
  Promise.resolve(1),
);
const saverSchedule = new SaverScheduleService(
  database.db,
  deliverySettings,
  timers,
  () => new Date(),
);
const locations = new LocationService(new HttpRedirects(fetch), logger);
const landmarks = new LandmarkService(
  database.db,
  new LandmarksRepo(),
  new Nominatim(env.NOMINATIM_USER_AGENT, fetch, {
    now: () => new Date(),
    wait: (ms) => sleep(ms),
  }),
  logger,
);
const checkout = new CheckoutService(customers, orders, shops, delivery, () => new Date());
const deadlines = new PaymentDeadlineService(
  orders,
  customers,
  new TelegramOrderNotifier(telegramApi),
  () => new Date(),
);
timers.register(orderTimerKinds.paymentReminder, (timer) => deadlines.remind(timer));
timers.register(orderTimerKinds.expire, (timer) => deadlines.expire(timer));

const messenger = new TelegramMessenger(telegramApi);
const conversationsRepo = new ConversationsRepo();
const notifier = new OwnerNotifier(database.db, conversationsRepo, shops, messenger, logger);
const conversations = new ConversationService(
  database.db,
  conversationsRepo,
  notifier,
  messenger,
  timers,
  () => new Date(),
);
timers.register(HAND_BACK_TIMER, (timer) => conversations.handBackIfSilent(timer));
const orderAlerts = new OrderAlerts(orders, conversations, notifier);
events.subscribe('order.created', (event) => orderAlerts.orderCreated(event));

const driversRepo = new DriversRepo();
const deliveryJobs = new DeliveryJobsRepo();
const drivers = new DriverService(
  database.db,
  driversRepo,
  shops,
  botInfo.username,
  () => new Date(),
);
const jobOffers = new JobOffers(
  database.db,
  deliveryJobs,
  driversRepo,
  shops,
  messenger,
  timers,
  logger,
  () => new Date(),
);
const deliveryAlerts = new DeliveryOwnerAlerts(shops, messenger, logger);
const dispatch = new DispatchService(
  database.db,
  deliveryJobs,
  driversRepo,
  jobOffers,
  orders,
  customers,
  shops,
  delivery,
  messenger,
  () => new Date(),
);
events.subscribe('order.transitioned', (event) => dispatch.orderTransitioned(event));
const trips = new TripService(
  database.db,
  deliveryJobs,
  driversRepo,
  orders,
  customers,
  messenger,
  deliveryAlerts,
  events,
  timers,
  logger,
  () => new Date(),
);
const bonuses = new OfferBonusService(database.db, deliveryJobs, jobOffers);
const tripDetails = new TripDetails(database.db, deliveryJobs, driversRepo);
const saverRuns = new SaverRunService(
  orders,
  shops,
  routes,
  delivery,
  saverSchedule,
  dispatch,
  logger,
);
timers.register(RECEIPT_TIMER, (timer) => trips.receiptTimeout(timer));
timers.register(SAVER_RUN_TIMER, (timer) => saverRuns.runScheduled(timer));

const jobs = new JobService(
  new Map<string, Job>([
    ['tick', () => timers.tick()],
    ['saver-run', () => saverRuns.runAll()],
  ]),
);
const receiptPage = timedFetch(RECEIPT_PAGE_TIMEOUT_MS);
const receiptReader = new ReceiptReader(model, logger);
const paymentProofs = new PaymentProofsRepo();
const paymentRefs = new PaymentRefsRepo(database.db);
const risk = new RiskService(new RiskSignalsRepo(database.db), env.RISK_HASH_SECRET);
const paymentNotifier = new PaymentNotifier(shops, orders, messenger, logger);
const verification = new PaymentVerification(
  database.db,
  paymentProofs,
  paymentRefs,
  receiptReader,
  new BankReceipts({
    telebirr: new TelebirrReceipts(receiptPage),
    cbe_bank: new CbeReceipts(receiptPage),
  }),
  risk,
  orders,
  shops,
  customers,
  paymentNotifier,
);
const demand = new DemandService(database.db, new DemandRepo(), events);
const photoSearch = new PhotoSearchService(
  database.db,
  catalogRepo,
  catalog,
  model,
  demand,
  logger,
);
const imageIntake = new ImageIntake(
  new TelegramFiles(telegramApi, env.TELEGRAM_BOT_TOKEN),
  receiptReader,
  orders,
  verification,
  photoSearch,
  customers,
);
const paymentReview = new PaymentReview(
  database.db,
  paymentProofs,
  paymentRefs,
  risk,
  orders,
  customers,
  paymentNotifier,
);

const customerChat = new TelegramCustomerChat(telegramApi);
const customerMemory = new CustomerMemoryService(database.db, new CustomerFactsRepo());
const decisions = new DecisionsRepo();
const guard = new PolicyGuard(database.db, decisions);
const ownerAlerts = new OwnerAlerts(shops, messenger, logger);
const areaNotes = new AreaNoteService(database.db, new AreaNotesRepo(), () => new Date());
const customerMessages = new CustomerMessages(orders, customers, conversations, messenger);
const rescheduler = new DeliveryRescheduler(
  database.db,
  orders,
  customers,
  trips,
  conversations,
  customerMessages,
  messenger,
  timers,
  logger,
  () => new Date(),
);
timers.register(RESCHEDULE_TIMER, (timer) => rescheduler.rescheduleIfSilent(timer));
const operationsToolDeps = {
  customerMessages,
  trips: tripDetails,
  messenger,
  now: () => new Date(),
  rescheduler,
  orders,
  areaNotes,
  guard,
  catalog,
  ownerAlerts,
  customers,
  demand,
  bonuses,
  conversations,
};
const opsTools = operationsTools(operationsToolDeps);
const registry = new ToolRegistry(
  [
    ...salesTools({
      catalog,
      customers,
      orders,
      checkout,
      chat: customerChat,
      evidence: new PriceEvidenceService(customers, orders, negotiations, () => new Date()),
      demand,
      negotiations,
      guard,
      landmarks,
      memory: customerMemory,
      conversations,
    }),
    ...opsTools,
  ],
  guard,
  logger,
);
const runtime = new AgentRuntime(model, registry, database.db, new TracesRepo(), () =>
  performance.now(),
);
const salesAgent = new SalesAgent(
  runtime,
  new SalesContext(catalog, customers, orders, customerMemory),
  customers,
  conversations,
  customerMemory,
  logger,
);

const approvals = new OwnerApprovals(
  database.db,
  decisions,
  operationsApprovals(opsTools, operationsToolDeps),
  ownerAlerts,
  logger,
  () => new Date(),
);
const operationsAgent = new OperationsAgent(
  runtime,
  approvals,
  ownerAlerts,
  logger,
  () => new Date(),
);
const situations = new SituationBuilder(
  orders,
  catalog,
  conversations,
  areaNotes,
  () => new Date(),
);
const operations = new OperationsTriggers(
  operationsAgent,
  situations,
  orders,
  tripDetails,
  conversations,
  () => new Date(),
);
const problems = new CustomerProblems(
  database.db,
  new DeliveryProblemsRepo(),
  orders,
  customers,
  catalog,
  messenger,
  conversations,
  situations,
  operationsAgent,
);
timers.register(OFFER_UNANSWERED_TIMER, (timer) => operations.offerUnanswered(timer));
timers.register(DELIVERY_LATE_TIMER, (timer) => operations.deliveryLate(timer));
events.subscribe('waitlist.joined', (event) => operations.waitlistJoined(event));
events.subscribe('delivery.problem_reported', (event) => problems.problemReported(event));

const bot = createBot({
  token: env.TELEGRAM_BOT_TOKEN,
  botInfo,
  ownedShopIds: (telegramUserId) => shops.ownedShopIds(telegramUserId),
  driverShopIds: (telegramUserId) => drivers.shopIds(telegramUserId),
  handlers: [
    createDriverHandlers(drivers),
    createDispatchHandlers({ dispatch, trips }),
    createApprovalHandlers(approvals),
    createConversationHandlers({ conversations, customers }),
    createPurchaseHandlers({
      catalog,
      customers,
      checkout,
      locations,
      landmarks,
      chat: customerChat,
    }),
    createPaymentHandlers({
      intake: imageIntake,
      review: paymentReview,
      customers,
      chat: customerChat,
    }),
    createReorderHandlers(checkout),
    createCatalogHandlers(catalog),
    createDemandHandlers({ demand, customers }),
    createOperationsHandlers({ triggers: operations, problems, customers }),
    // Last, so every button and code path answers before the model does.
    createSalesHandlers({ agent: salesAgent, customers }),
  ],
});

const updatesRepo = new TelegramUpdatesRepo(database.db);
const worker = new UpdateWorker(updatesRepo, (update) => bot.handleUpdate(update), logger);
const ingress = new TelegramIngress(updatesRepo, worker);

const auth = new AuthService({
  botToken: env.TELEGRAM_BOT_TOKEN,
  tokenSecret: env.AUTH_TOKEN_SECRET,
  now: () => new Date(),
});

const ownerAuth = requireAuth((token) => auth.verifyToken(token));
const shopOwner = requireShopOwner((telegramUserId) => shops.ownedShopIds(telegramUserId));

const app = createApp({
  logger,
  routers: [
    createTelegramWebhookRouter({ secret: env.TELEGRAM_WEBHOOK_SECRET, ingress }),
    createJobsRouter(jobs, env.JOB_SECRET),
    createAuthRouter(auth),
    createShopsRouter({ shops, requireAuth: ownerAuth, requireShopOwner: shopOwner }),
    createCatalogRouter({ catalog, requireAuth: ownerAuth, requireShopOwner: shopOwner }),
    createDeliveryRouter({
      delivery,
      saverSchedule,
      requireAuth: ownerAuth,
      requireShopOwner: shopOwner,
    }),
    createDriversRouter({ drivers, requireAuth: ownerAuth, requireShopOwner: shopOwner }),
  ],
});
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'server started');
});

await updatesRepo.requeueInterrupted();
worker.wake();

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  server.close(() => {
    worker
      .idle()
      .then(() => database.close())
      .then(
        () => process.exit(0),
        (err: unknown) => {
          logger.error({ err }, 'shutdown failed');
          process.exit(1);
        },
      );
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
