import { loadEnv } from './config/env';
import { createLogger } from './config/logger';
import { createApp } from './http/app';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const env = loadEnv(process.env);
const logger = createLogger(env);
const server = createApp({ logger }).listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'server started');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
