import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { createJobsRouter } from '../modules/jobs/jobs.routes';
import type { JobService } from '../modules/jobs/jobs.service';
import { errorHandler, notFound } from './middleware/errors';

export interface AppDeps {
  logger: Logger;
  jobs: JobService;
  jobSecret: string;
}

export function createApp({ logger, jobs, jobSecret }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id'];
        const requestId = typeof id === 'string' && id !== '' ? id : randomUUID();
        res.setHeader('x-request-id', requestId);
        return requestId;
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/jobs', createJobsRouter(jobs, jobSecret));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
