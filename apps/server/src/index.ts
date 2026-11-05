import { Api } from 'grammy';
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
import { createShopsRouter } from './modules/shops/shops.routes';
import { ShopsService } from './modules/shops/shops.service';
import { TelegramChannels } from './telegram/channels';
import { createBot } from './telegram/bot';
import { TelegramIngress } from './telegram/ingress';
import { TelegramUpdatesRepo } from './telegram/updates.repo';
import { createTelegramWebhookRouter } from './telegram/webhook.routes';
import { UpdateWorker } from './telegram/worker';

const SHUTDOWN_TIMEOUT_MS = 10_000;

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

const bot = createBot({
  token: env.TELEGRAM_BOT_TOKEN,
  botInfo,
  ownedShopIds: (telegramUserId) => shops.ownedShopIds(telegramUserId),
  handlers: [createCatalogHandlers(catalog)],
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
