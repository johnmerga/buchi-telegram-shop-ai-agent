import { loadEnv } from './config/env';
import { createLogger } from './config/logger';
import { connectDatabase } from './db/client';
import { createApp } from './http/app';
import { createAuthRouter } from './modules/auth/auth.routes';
import { AuthService } from './modules/auth/auth.service';
import { createJobsRouter } from './modules/jobs/jobs.routes';
import { JobService } from './modules/jobs/jobs.service';
import { TimersRepo } from './modules/jobs/timers.repo';
import { TimerService } from './modules/jobs/timers.service';
import { ShopsRepo } from './modules/shops/shops.repo';
import { ShopsService } from './modules/shops/shops.service';
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

const shops = new ShopsService(new ShopsRepo(database.db));
const bot = createBot({
  token: env.TELEGRAM_BOT_TOKEN,
  ownedShopIds: (telegramUserId) => shops.ownedShopIds(telegramUserId),
});
await bot.init();

const updatesRepo = new TelegramUpdatesRepo(database.db);
const worker = new UpdateWorker(updatesRepo, (update) => bot.handleUpdate(update), logger);
const ingress = new TelegramIngress(updatesRepo, worker);

const auth = new AuthService({
  botToken: env.TELEGRAM_BOT_TOKEN,
  tokenSecret: env.AUTH_TOKEN_SECRET,
  now: () => new Date(),
});

const app = createApp({
  logger,
  routers: [
    createTelegramWebhookRouter({ secret: env.TELEGRAM_WEBHOOK_SECRET, ingress }),
    createJobsRouter(jobs, env.JOB_SECRET),
    createAuthRouter(auth),
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
