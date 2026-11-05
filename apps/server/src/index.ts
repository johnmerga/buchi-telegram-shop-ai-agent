import { GoogleGenAI } from '@google/genai';
import { Api } from 'grammy';
import { GeminiModel } from './ai/gemini';
import { QuotaManager } from './ai/quota';
import { loadEnv } from './config/env';
import { createLogger } from './config/logger';
import { connectDatabase } from './db/client';
import { createApp } from './http/app';
import { requireAuth } from './http/middleware/require-auth';
import { requireShopOwner } from './http/middleware/require-shop-owner';
import { createCatalogHandlers } from './modules/catalog/catalog.handlers';
import { CatalogRepo } from './modules/catalog/catalog.repo';
import { createCatalogRouter } from './modules/catalog/catalog.routes';
import { CatalogService } from './modules/catalog/catalog.service';
import { createAuthRouter } from './modules/auth/auth.routes';
import { AuthService } from './modules/auth/auth.service';
import { createJobsRouter } from './modules/jobs/jobs.routes';
import { JobService } from './modules/jobs/jobs.service';
import { TimersRepo } from './modules/jobs/timers.repo';
import { TimerService } from './modules/jobs/timers.service';
import { ShopsRepo } from './modules/shops/shops.repo';
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
import { createConversationHandlers } from './modules/owner/conversations.handlers';
import { ConversationsRepo } from './modules/owner/conversations.repo';
import { ConversationService, HAND_BACK_TIMER } from './modules/owner/conversations.service';
import { OrderAlerts } from './modules/owner/order-alerts.service';
import { OwnerNotifier } from './modules/owner/owner-notifier.service';
import { createShopsRouter } from './modules/shops/shops.routes';
import { ShopsService } from './modules/shops/shops.service';
import { TelegramChannels } from './telegram/channels';
import { EventBus } from './shared/events';
import { BankReceipts } from './integrations/receipts/bank-receipts';
import { CbeReceipts } from './integrations/receipts/cbe';
import { timedFetch } from './integrations/receipts/fetch-page';
import { TelebirrReceipts } from './integrations/receipts/telebirr';
import { createBot } from './telegram/bot';
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
const jobs = new JobService(new Map([['tick', () => timers.tick()]]));

const telegramApi = new Api(env.TELEGRAM_BOT_TOKEN);
const botInfo = await telegramApi.getMe();
const channels = new TelegramChannels(telegramApi, botInfo.id);

const shops = new ShopsService(database.db, new ShopsRepo(database.db), channels);
const catalog = new CatalogService(
  database.db,
  new CatalogRepo(),
  shops,
  channels,
  botInfo.username,
);

const events = new EventBus(logger);
const customers = new CustomersService(
  database.db,
  new CustomersRepo(),
  new SessionsRepo(database.db),
);
const orders = new OrderService(database.db, new OrdersRepo(), events, timers);
const checkout = new CheckoutService(customers, orders, shops, () => new Date());
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

const model = new GeminiModel(
  new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }).models,
  {
    models: {
      fast: env.GEMINI_MODEL_FAST,
      smart: env.GEMINI_MODEL_SMART,
      embedding: env.GEMINI_MODEL_EMBED,
    },
    embeddingDimensions: env.GEMINI_EMBEDDING_DIMENSIONS,
  },
  new QuotaManager(
    {
      requestsPerMinute: env.GEMINI_REQUESTS_PER_MINUTE,
      requestsPerDay: env.GEMINI_REQUESTS_PER_DAY,
    },
    () => new Date(),
  ),
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
const imageIntake = new ImageIntake(
  new TelegramFiles(telegramApi, env.TELEGRAM_BOT_TOKEN),
  receiptReader,
  orders,
  verification,
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

const bot = createBot({
  token: env.TELEGRAM_BOT_TOKEN,
  botInfo,
  ownedShopIds: (telegramUserId) => shops.ownedShopIds(telegramUserId),
  handlers: [
    createConversationHandlers({ conversations, customers }),
    createPurchaseHandlers({ catalog, customers, checkout, conversations }),
    createPaymentHandlers({ intake: imageIntake, review: paymentReview, customers }),
    createReorderHandlers(checkout),
    createCatalogHandlers(catalog),
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
