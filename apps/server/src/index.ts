import { loadEnv } from './config/env';
import { createLogger } from './config/logger';
import { connectDatabase } from './db/client';
import { createApp } from './http/app';
import { JobService } from './modules/jobs/jobs.service';
import { TimersRepo } from './modules/jobs/timers.repo';
import { TimerService } from './modules/jobs/timers.service';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const env = loadEnv(process.env);
const logger = createLogger(env);
const database = connectDatabase(env.DATABASE_URL);
const timers = new TimerService(new TimersRepo(database.db), logger);
const jobs = new JobService(new Map([['tick', () => timers.tick()]]));

const server = createApp({ logger, jobs, jobSecret: env.JOB_SECRET }).listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'server started');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    database.close().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error({ err }, 'closing the database failed');
        process.exit(1);
      },
    );
  });
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
