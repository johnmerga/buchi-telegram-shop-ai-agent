import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { GoogleGenAI } from '@google/genai';
import { Api } from 'grammy';
import { FarPriceEstimator } from './ai/agents/far-price/far-price-estimator';
import { OperationsAgent } from './ai/agents/operations/operations-agent';
import { operationsApprovals, operationsTools } from './ai/agents/operations/operations-tools';
import { SituationBuilder } from './ai/agents/operations/situation-builder';
import { DecisionLog } from './ai/approvals/decision-log.service';
import { OwnerApprovals } from './ai/approvals/owner-approvals.service';
import { OwnerAssistant } from './ai/agents/owner-assistant/owner-assistant';
import { ownerAssistantTools } from './ai/agents/owner-assistant/owner-assistant-tools';
import { weeklyAnalysisTool } from './ai/agents/owner-assistant/tools/weekly-analysis';
import { WeeklySuggestions } from './ai/agents/owner-assistant/weekly-suggestions';
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
import { limitSignedInUsers, publicRateLimits } from './http/rate-limits';
import { createWebAppRouter } from './http/web-app';
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
import { GoogleServiceAccount } from './integrations/google-auth';
import { Nominatim } from './integrations/nominatim';
import { HttpRedirects } from './integrations/redirects';
import { OpenRouteService } from './integrations/ors';
import { QuickChart } from './integrations/quickchart';
import { GoogleSheets } from './integrations/sheets';
import { AreaNotesRepo } from './modules/delivery/area-notes.repo';
import { AreaNoteService } from './modules/delivery/area-notes.service';
import { DeliverySettingsRepo } from './modules/delivery/delivery-settings.repo';
import { createDeliveryRouter } from './modules/delivery/delivery.routes';
import { DeliveryService } from './modules/delivery/delivery.service';
import { LandmarksRepo } from './modules/delivery/landmarks.repo';
import { LandmarkService } from './modules/delivery/landmarks.service';
import { LocationService } from './modules/delivery/location.service';
import { createPlacesRouter } from './modules/delivery/places.routes';
import { PlaceSearchService } from './modules/delivery/places.service';
import { RouteService } from './modules/delivery/route.service';
import { SaverScheduleService, SAVER_RUN_TIMER } from './modules/delivery/saver-schedule.service';
import { ZoneFactorsRepo } from './modules/delivery/zone-factors.repo';
import { ZoneFactorService } from './modules/delivery/zone-factors.service';
import { createZonesRouter } from './modules/delivery/zones.routes';
import { DeliveryJobsRepo } from './modules/drivers/delivery-jobs.repo';
import { DeliveryMapRepo } from './modules/drivers/delivery-map.repo';
import { createDeliveryMapRouter } from './modules/drivers/delivery-map.routes';
import { DeliveryMapService } from './modules/drivers/delivery-map.service';
import { createDispatchHandlers } from './modules/drivers/dispatch.handlers';
import { LiveTracking } from './modules/drivers/live-tracking.service';
import { DispatchService } from './modules/drivers/dispatch.service';
import { createDriverHandlers } from './modules/drivers/drivers.handlers';
import { DriversRepo } from './modules/drivers/drivers.repo';
import { createDriversRouter } from './modules/drivers/drivers.routes';
import { createDriverAppRouter } from './modules/drivers/driver-app.routes';
import { DriverBoardRepo } from './modules/drivers/driver-board.repo';
import { DriverBoardService } from './modules/drivers/driver-board.service';
import { DriverService } from './modules/drivers/drivers.service';
import { JobOffers, OFFER_UNANSWERED_TIMER } from './modules/drivers/job-offers.service';
import { OfferBonusService } from './modules/drivers/offer-bonus.service';
import { DeliveryOwnerAlerts } from './modules/drivers/owner-alerts.service';
import { SaverRunService } from './modules/drivers/saver-runs.service';
import { SpecialOffers, SPECIAL_OFFER_RAISE_TIMER } from './modules/drivers/special-offers.service';
import { SpecialJobsRepo } from './modules/drivers/special-jobs.repo';
import { AcceptanceFactorService } from './modules/far-quotes/acceptance-factors.service';
import { FarQuoteEvidence } from './modules/far-quotes/far-quote-evidence.service';
import { FarQuoteOutcomes } from './modules/far-quotes/far-quote-outcomes.service';
import { createFarQuoteHandlers } from './modules/far-quotes/far-quotes.handlers';
import { FarQuotesRepo } from './modules/far-quotes/far-quotes.repo';
import { FarQuoteService } from './modules/far-quotes/far-quotes.service';
import { NightlyLearningService } from './modules/jobs/nightly-learning.service';
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
import { OrderBoardRepo } from './modules/orders/order-board.repo';
import { OrderBoardService } from './modules/orders/order-board.service';
import { OrderTrackingService } from './modules/orders/order-tracking.service';
import { OrdersRepo } from './modules/orders/orders.repo';
import { createOrdersRouter } from './modules/orders/orders.routes';
import { OrderService } from './modules/orders/orders.service';
import { StockHoldsRepo } from './modules/orders/stock-holds.repo';
import { OwnerRulesRepo } from './modules/rules/rules.repo';
import { OwnerRulesService } from './modules/rules/rules.service';
import { createReorderHandlers } from './modules/orders/orders.reorder.handlers';
import { createPurchaseHandlers } from './modules/orders/purchase.handlers';
import { ImageIntake } from './modules/payments/image-intake.service';
import { PaymentNotifier } from './modules/payments/payment-notifier.service';
import { PaymentProofsRepo } from './modules/payments/payment-proofs.repo';
import { PaymentRecords } from './modules/payments/payment-records.service';
import { PaymentRefsRepo } from './modules/payments/payment-refs.repo';
import { PaymentReports } from './modules/payments/payment-reports.service';
import { PaymentReview } from './modules/payments/payment-review.service';
import { PaymentVerification } from './modules/payments/payment-verification.service';
import { createPaymentHandlers } from './modules/payments/payments.handlers';
import { createPaymentsRouter } from './modules/payments/payments.routes';
import { ReceiptLinks } from './modules/payments/receipt-links.service';
import { ReceiptReader } from './modules/payments/receipt-reader.service';
import { RiskSignalsRepo } from './modules/payments/risk-signals.repo';
import { RiskService } from './modules/payments/risk.service';
import { createAiDecisionsRouter } from './modules/owner/ai-decisions.routes';
import { createApprovalHandlers } from './modules/owner/approvals.handlers';
import { createConversationHandlers } from './modules/owner/conversations.handlers';
import { ConversationsRepo } from './modules/owner/conversations.repo';
import { createConversationsRouter } from './modules/owner/conversations.routes';
import { ConversationService, HAND_BACK_TIMER } from './modules/owner/conversations.service';
import { OrderAlerts } from './modules/owner/order-alerts.service';
import { OwnerAlerts } from './modules/owner/owner-alerts.service';
import { OwnerNotifier } from './modules/owner/owner-notifier.service';
import { createDemandHandlers } from './modules/demand/demand.handlers';
import { WaitlistNotifier } from './modules/demand/waitlist-notifier.service';
import { ReportingRepo } from './modules/reporting/reporting.repo';
import { ReportingService } from './modules/reporting/reporting.service';
import { createListingHandlers } from './modules/listings/listings.handlers';
import { ListingsRepo } from './modules/listings/listings.repo';
import { ListingService } from './modules/listings/listings.service';
import { createAssistantHandlers } from './modules/owner/assistant.handlers';
import { DemandRepo } from './modules/demand/demand.repo';
import { DemandService } from './modules/demand/demand.service';
import { NegotiationService } from './modules/sales/negotiation.service';
import { NegotiationsRepo } from './modules/sales/negotiations.repo';
import { PriceEvidenceService } from './modules/sales/price-evidence.service';
import { ReplyTimesRepo } from './modules/sales/reply-times.repo';
import { ReplyTimes } from './modules/sales/reply-times.service';
import { createSalesHandlers } from './modules/sales/sales.handlers';
import { DailyReportsRepo } from './modules/reports/daily-reports.repo';
import { DailyReports } from './modules/reports/daily-reports.service';
import { InsightsRepo } from './modules/reports/insights.repo';
import { InsightsService } from './modules/reports/insights.service';
import { LedgerRepo } from './modules/reports/ledger.repo';
import { LedgerService } from './modules/reports/ledger.service';
import { createReportsRouter } from './modules/reports/reports.routes';
import { SalesLedger } from './modules/reports/sales-ledger.service';
import { createShopsRouter } from './modules/shops/shops.routes';
import { LiveEvents } from './modules/live/live-events.service';
import { createLiveRouter } from './modules/live/live.routes';
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
import { TelegramPhotoUploads } from './telegram/photo-uploads';
import { TelegramLiveMap } from './telegram/live-map';
import { TelegramMessenger } from './telegram/messenger';
import { skipDemoRecipients } from './telegram/demo-recipients';
import { TelegramIngress } from './telegram/ingress';
import { MiniAppLinks } from './telegram/mini-app-links';
import { TelegramOrderNotifier } from './telegram/order-notifier';
import { TelegramUpdatesRepo } from './telegram/updates.repo';
import { createTelegramWebhookRouter } from './telegram/webhook.routes';
import { UpdateWorker } from './telegram/worker';

const SHUTDOWN_TIMEOUT_MS = 10_000;
/** The same path from `src/` under tsx and from `dist/` after the build. */
const WEB_DIST_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));
/** Bank receipt pages are optional evidence, so a slow page must not hold up a customer's reply. */
const RECEIPT_PAGE_TIMEOUT_MS = 8_000;

const env = loadEnv(process.env);
const logger = createLogger(env);
const database = connectDatabase(env.DATABASE_URL);

const timers = new TimerService(new TimersRepo(database.db), logger);

const telegramApi = new Api(env.TELEGRAM_BOT_TOKEN);
telegramApi.config.use(skipDemoRecipients(logger));
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
  {
    generate: new QuotaManager(
      {
        requestsPerMinute: env.GEMINI_REQUESTS_PER_MINUTE,
        requestsPerDay: env.GEMINI_REQUESTS_PER_DAY,
      },
      () => new Date(),
    ),
    embed: new QuotaManager(
      {
        requestsPerMinute: env.GEMINI_EMBED_REQUESTS_PER_MINUTE,
        requestsPerDay: env.GEMINI_EMBED_REQUESTS_PER_DAY,
      },
      () => new Date(),
    ),
  },
);
const catalogRepo = new CatalogRepo();
const events = new EventBus(logger);
const embeddings = new ProductEmbeddingService(
  database.db,
  catalogRepo,
  model,
  timers,
  () => new Date(),
  logger,
  events,
);
timers.register(PRODUCT_EMBEDDING_TIMER, (timer) => embeddings.embed(timer));
const catalog = new CatalogService(
  database.db,
  catalogRepo,
  shops,
  channels,
  botInfo.username,
  embeddings,
  events,
);

const customers = new CustomersService(
  database.db,
  new CustomersRepo(),
  new SessionsRepo(database.db),
);
const negotiations = new NegotiationService(database.db, new NegotiationsRepo());
const ownerRules = new OwnerRulesService(database.db, new OwnerRulesRepo(), () => new Date());
const orders = new OrderService(
  database.db,
  new OrdersRepo(),
  events,
  timers,
  negotiations,
  ownerRules,
  new StockHoldsRepo(),
);
const routes = new RouteService(
  new OpenRouteService({ baseUrl: env.ORS_BASE_URL, apiKey: env.ORS_API_KEY }, fetch),
  logger,
  () => new Date(),
);
const zoneFactors = new ZoneFactorService(new ZoneFactorsRepo(database.db), () => new Date());
const deliverySettings = new DeliverySettingsRepo();
const delivery = new DeliveryService(
  database.db,
  deliverySettings,
  shops,
  routes,
  (destination) => zoneFactors.timeFactor(destination),
  ownerRules,
);
const saverSchedule = new SaverScheduleService(
  database.db,
  deliverySettings,
  timers,
  () => new Date(),
);
const locations = new LocationService(new HttpRedirects(fetch), logger);
// One client for both searches, so together they keep Nominatim's one request a second.
const nominatim = new Nominatim(env.NOMINATIM_USER_AGENT, fetch, {
  now: () => new Date(),
  wait: (ms) => sleep(ms),
});
const landmarks = new LandmarkService(database.db, new LandmarksRepo(), nominatim, logger);
const checkout = new CheckoutService(customers, orders, shops, delivery, () => new Date());
const deadlines = new PaymentDeadlineService(
  orders,
  customers,
  new TelegramOrderNotifier(telegramApi),
  () => new Date(),
);
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
const specialOffers = new SpecialOffers(
  database.db,
  deliveryJobs,
  new SpecialJobsRepo(),
  driversRepo,
  jobOffers,
  timers,
  events,
  () => new Date(),
);
const dispatch = new DispatchService(
  database.db,
  deliveryJobs,
  driversRepo,
  jobOffers,
  specialOffers,
  orders,
  customers,
  shops,
  delivery,
  messenger,
  () => new Date(),
);
events.subscribe('order.transitioned', (event) => dispatch.orderTransitioned(event));
const live = new LiveEvents();
events.subscribe('order.created', ({ shopId, orderId }) => {
  live.publish(shopId, { type: 'order.created', orderId });
  return Promise.resolve();
});
events.subscribe('order.transitioned', ({ shopId, orderId, from, to }) => {
  live.publish(shopId, { type: 'order.transitioned', orderId, from, to });
  return Promise.resolve();
});
const liveTracking = new LiveTracking(
  database.db,
  deliveryJobs,
  driversRepo,
  orders,
  customers,
  messenger,
  new TelegramLiveMap(telegramApi),
  logger,
  () => new Date(),
);
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
  zoneFactors,
  liveTracking,
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

const receiptPage = timedFetch(RECEIPT_PAGE_TIMEOUT_MS);
const receiptReader = new ReceiptReader(model, logger);
const paymentProofs = new PaymentProofsRepo();
const paymentRefs = new PaymentRefsRepo(database.db);
const risk = new RiskService(new RiskSignalsRepo(database.db), env.RISK_HASH_SECRET);
const paymentNotifier = new PaymentNotifier(shops, orders, messenger, logger);
const bankReceipts = new BankReceipts({
  telebirr: new TelebirrReceipts(receiptPage),
  cbe_bank: new CbeReceipts(receiptPage),
});
const verification = new PaymentVerification(
  database.db,
  paymentProofs,
  paymentRefs,
  receiptReader,
  bankReceipts,
  risk,
  orders,
  shops,
  customers,
  paymentNotifier,
  () => new Date(),
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
const telegramFiles = new TelegramFiles(telegramApi, env.TELEGRAM_BOT_TOKEN);
const imageIntake = new ImageIntake(
  telegramFiles,
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

const paymentReports = new PaymentReports(database.db, paymentProofs, orders, paymentNotifier);
const paymentRecords = new PaymentRecords(database.db, paymentProofs, orders, customers, risk);

const customerChat = new TelegramCustomerChat(
  telegramApi,
  env.WEB_APP_URL === undefined ? undefined : new MiniAppLinks(env.WEB_APP_URL),
);
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
const waitlistNotifier = new WaitlistNotifier(
  demand,
  orders,
  catalog,
  customers,
  conversations,
  customerMessages,
  customerChat,
  logger,
  () => new Date(),
);
events.subscribe('variant.restocked', (event) => waitlistNotifier.variantRestocked(event));
events.subscribe('product.embedded', (event) => waitlistNotifier.productEmbedded(event));
timers.register(orderTimerKinds.holdExpire, (timer) => waitlistNotifier.holdExpired(timer));
const listings = new ListingService(
  database.db,
  new ListingsRepo(),
  model,
  telegramFiles,
  catalog,
  logger,
);
const reporting = new ReportingService(
  database.db,
  new ReportingRepo(database.db),
  () => new Date(),
);
const ownerTools = ownerAssistantTools({
  rules: ownerRules,
  delivery,
  catalog,
  reporting,
  now: () => new Date(),
});
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
    ...ownerTools.tools,
  ],
  guard,
  logger,
);
const traces = new TracesRepo();
const runtime = new AgentRuntime(model, registry, database.db, traces, () => performance.now());
const salesAgent = new SalesAgent(
  runtime,
  new SalesContext(catalog, customers, orders, customerMemory),
  customers,
  conversations,
  customerMemory,
  logger,
);

const farQuotesRepo = new FarQuotesRepo();
const acceptance = new AcceptanceFactorService(database.db, farQuotesRepo, () => new Date());
const farQuotes = new FarQuoteService(
  database.db,
  farQuotesRepo,
  orders,
  customers,
  delivery,
  new FarQuoteEvidence(zoneFactors, acceptance, areaNotes, () => new Date()),
  new FarPriceEstimator(
    (tools) =>
      new AgentRuntime(model, new ToolRegistry(tools, guard, logger), database.db, traces, () =>
        performance.now(),
      ),
    guard,
    logger,
  ),
  guard,
  specialOffers,
  deliveryAlerts,
  messenger,
  logger,
  () => new Date(),
);
const farQuoteOutcomes = new FarQuoteOutcomes(
  database.db,
  farQuotesRepo,
  orders,
  checkout,
  customers,
  specialOffers,
  messenger,
);
timers.register(SPECIAL_OFFER_RAISE_TIMER, (timer) => farQuotes.raiseDue(timer));
timers.register(orderTimerKinds.quoteExpire, (timer) => farQuoteOutcomes.holdExpired(timer));
events.subscribe('delivery.offer_held', (event) => farQuoteOutcomes.driverHeld(event));
events.subscribe('order.transitioned', (event) => farQuoteOutcomes.orderTransitioned(event));

const ledger = new LedgerService(
  database.db,
  new LedgerRepo(),
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL !== undefined && env.GOOGLE_SERVICE_ACCOUNT_KEY !== undefined
    ? {
        serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        sheets: googleSheets(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_SERVICE_ACCOUNT_KEY),
      }
    : undefined,
  logger,
  () => new Date(),
);
const salesLedger = new SalesLedger(orders, paymentRecords, ledger, () => new Date());
events.subscribe('order.transitioned', (event) => salesLedger.orderTransitioned(event));
const dailyReportsRepo = new DailyReportsRepo();
const dailyReports = new DailyReports(
  database.db,
  dailyReportsRepo,
  ownerAlerts,
  ledger,
  logger,
  () => new Date(),
);

const updatesRepo = new TelegramUpdatesRepo(database.db);
const nightlyLearning = new NightlyLearningService(
  zoneFactors,
  acceptance,
  orders,
  customers,
  updatesRepo,
  logger,
  () => new Date(),
);
const jobs = new JobService(
  new Map<string, Job>([
    // The tick also retries the Sheets ledger, so a Sheets outage needs no cron job of its own.
    ['tick', async () => ({ ...(await timers.tick()), ...(await ledger.flush()) })],
    ['saver-run', () => saverRuns.runAll()],
    ['nightly-learning', () => nightlyLearning.run()],
    ['evening-summary', () => dailyReports.eveningSummaries()],
    ['morning-brief', () => dailyReports.morningBriefs()],
    ['weekly-suggestions', () => weeklySuggestions.run()],
  ]),
);
const approvals = new OwnerApprovals(
  database.db,
  decisions,
  [...operationsApprovals(opsTools), ...ownerTools.approvals],
  ownerAlerts,
  logger,
  () => new Date(),
);
const ownerAssistantAgent = new OwnerAssistant(
  runtime,
  approvals,
  new QuickChart(fetch),
  logger,
  () => new Date(),
);
const weeklySuggestions = new WeeklySuggestions(
  new AgentRuntime(
    model,
    new ToolRegistry([weeklyAnalysisTool({ reporting, delivery })], guard, logger),
    database.db,
    traces,
    () => performance.now(),
  ),
  reporting,
  guard,
  approvals,
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
    createDispatchHandlers({ dispatch, trips, tracking: liveTracking, specialOffers }),
    createFarQuoteHandlers({ quotes: farQuotes, outcomes: farQuoteOutcomes }),
    createApprovalHandlers(approvals),
    createConversationHandlers({ conversations, customers }),
    createPurchaseHandlers({
      catalog,
      customers,
      checkout,
      locations,
      landmarks,
      chat: customerChat,
      farQuotes,
    }),
    createPaymentHandlers({
      intake: imageIntake,
      links: new ReceiptLinks(orders, shops, bankReceipts, verification),
      review: paymentReview,
      reports: paymentReports,
      customers,
      chat: customerChat,
    }),
    createReorderHandlers(checkout),
    createListingHandlers(listings),
    createCatalogHandlers(catalog),
    createDemandHandlers({ demand, customers }),
    createOperationsHandlers({ triggers: operations, problems, customers, trips }),
    // Last, so every button and code path answers before the model does.
    createAssistantHandlers({ assistant: ownerAssistantAgent, customers }),
    createSalesHandlers({
      agent: salesAgent,
      customers,
      replyTimes: new ReplyTimes(database.db, new ReplyTimesRepo()),
    }),
  ],
});
bot.api.config.use(skipDemoRecipients(logger));

const worker = new UpdateWorker(updatesRepo, (update) => bot.handleUpdate(update), logger);
const ingress = new TelegramIngress(updatesRepo, worker);

const auth = new AuthService({
  botToken: env.TELEGRAM_BOT_TOKEN,
  tokenSecret: env.AUTH_TOKEN_SECRET,
  now: () => new Date(),
});

const signedIn = limitSignedInUsers(
  requireAuth((token) => auth.verifyToken(token)),
  () => new Date(),
);
const shopOwner = requireShopOwner((telegramUserId) => shops.ownedShopIds(telegramUserId));

const app = createApp({
  logger,
  trustProxyHops: env.TRUST_PROXY_HOPS,
  routers: [
    // First, so a refused request costs no signature check or database query.
    publicRateLimits(() => new Date()),
    createTelegramWebhookRouter({ secret: env.TELEGRAM_WEBHOOK_SECRET, ingress }),
    createJobsRouter(jobs, env.JOB_SECRET),
    createAuthRouter(auth, botInfo.username),
    createShopsRouter({ shops, requireAuth: signedIn, requireShopOwner: shopOwner }),
    createCatalogRouter({
      catalog,
      uploads: new TelegramPhotoUploads(telegramApi),
      files: telegramFiles,
      requireAuth: signedIn,
      requireShopOwner: shopOwner,
    }),
    createDeliveryRouter({
      delivery,
      saverSchedule,
      requireAuth: signedIn,
      requireShopOwner: shopOwner,
    }),
    createDriversRouter({ drivers, requireAuth: signedIn, requireShopOwner: shopOwner }),
    createZonesRouter({ zoneFactors, requireAuth: signedIn, requireShopOwner: shopOwner }),
    createPlacesRouter({
      places: new PlaceSearchService(nominatim, logger),
      requireAuth: signedIn,
    }),
    createDeliveryMapRouter({
      deliveryMap: new DeliveryMapService(database.db, new DeliveryMapRepo(), shops),
      requireAuth: signedIn,
      requireShopOwner: shopOwner,
    }),
    createPaymentsRouter({
      records: paymentRecords,
      review: paymentReview,
      files: telegramFiles,
      requireAuth: signedIn,
      requireShopOwner: shopOwner,
    }),
    createConversationsRouter({
      conversations,
      requireAuth: signedIn,
      requireShopOwner: shopOwner,
    }),
    createAiDecisionsRouter({
      log: new DecisionLog(database.db, decisions, approvals),
      approvals,
      requireAuth: signedIn,
      requireShopOwner: shopOwner,
    }),
    createReportsRouter({
      insights: new InsightsService(
        database.db,
        new InsightsRepo(),
        dailyReportsRepo,
        () => new Date(),
      ),
      ledger,
      reports: dailyReports,
      requireAuth: signedIn,
      requireShopOwner: shopOwner,
    }),
    createOrdersRouter({
      board: new OrderBoardService(database.db, new OrderBoardRepo()),
      tracking: new OrderTrackingService(orders, shops),
      requireAuth: signedIn,
      requireShopOwner: shopOwner,
    }),
    createLiveRouter({ live, requireAuth: signedIn, requireShopOwner: shopOwner }),
    createDriverAppRouter({
      board: new DriverBoardService(
        database.db,
        new DriverBoardRepo(),
        deliveryJobs,
        driversRepo,
        shops,
        orders,
        customers,
      ),
      dispatch,
      specialOffers,
      trips,
      requireAuth: signedIn,
    }),
    // Last, so the web app's fallback pages never shadow an API route.
    createWebAppRouter(WEB_DIST_DIR),
  ],
});
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'server started');
});

await updatesRepo.requeueInterrupted();
worker.wake();

function googleSheets(email: string, privateKey: string): GoogleSheets {
  const account = new GoogleServiceAccount({ email, privateKey }, fetch, () => new Date());
  return new GoogleSheets(() => account.accessToken(), fetch);
}

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
