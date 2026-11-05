import { randomUUID } from 'node:crypto';
import express, { type Express, type Router } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { errorHandler, notFound } from './middleware/errors';
import { securityHeaders } from './middleware/security-headers';

export interface AppDeps {
  logger: Logger;
  routers: Router[];
  /** Proxies in front of the server, so `req.ip` is the client's address and not a proxy's. */
  trustProxyHops: number;
}

export function createApp({ logger, routers, trustProxyHops }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);
  app.use(securityHeaders);
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

  for (const router of routers) app.use(router);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
