import { loadEnv } from './config/env';
import { createLogger } from './config/logger';
import { connectDatabase } from './db/client';
import { createApp } from './http/app';
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

const shops = new ShopsService(new ShopsRepo(database.db));
const bot = createBot({
  token: env.TELEGRAM_BOT_TOKEN,
  ownedShopIds: (id) => shops.ownedShopIds(id),
});
await bot.init();

const updatesRepo = new TelegramUpdatesRepo(database.db);
const worker = new UpdateWorker(updatesRepo, (update) => bot.handleUpdate(update), logger);
const ingress = new TelegramIngress(updatesRepo, worker);

const app = createApp({
  logger,
  routers: [createTelegramWebhookRouter({ secret: env.TELEGRAM_WEBHOOK_SECRET, ingress })],
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
    void worker
      .idle()
      .then(() => database.close())
      .then(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
