import { Router, type Request, type RequestHandler } from 'express';
import { RateLimiter } from '../shared/rate-limiter';
import { callerOf } from './caller';
import { rateLimit } from './middleware/rate-limit';

const MINUTE_MS = 60_000;

/**
 * Requests a minute for each caller. The limits sit far above normal use and only stop floods,
 * because many Ethiopian mobile users share one carrier IP address.
 */
const limits = {
  /** One sign-in each time a Mini App opens, from every customer behind one carrier address. */
  signIn: 60,
  /**
   * Telegram sends every update from a few addresses, up to 40 connections at once by default. A
   * refused update is not lost: Telegram retries it, and the webhook stores each update once.
   */
  webhook: 1_200,
  /** cron-job.org calls the tick once a minute and each daily job once a day. */
  jobs: 30,
  /**
   * One signed-in user: a dashboard screen loads a few queries, refetches on each live event, and
   * the driver board refreshes every 15 seconds.
   */
  signedIn: 120,
} as const;

function limiter(limit: number, now: () => Date): RateLimiter {
  return new RateLimiter({ limit, windowMs: MINUTE_MS, now });
}

// `req.ip` is the client's address only when `trust proxy` matches the hosting's proxies.
const byIp = (req: Request) => req.ip ?? 'unknown';

/** Per-address limits on the endpoints that anyone can reach without signing in. */
export function publicRateLimits(now: () => Date): Router {
  const router = Router();
  router.use('/auth', rateLimit(limiter(limits.signIn, now), byIp));
  router.use('/telegram/webhook', rateLimit(limiter(limits.webhook, now), byIp));
  router.use('/jobs', rateLimit(limiter(limits.jobs, now), byIp));
  return router;
}

/**
 * Runs `authenticate`, then limits the signed-in Telegram user, so users behind one address do
 * not share a limit. A router is a middleware that runs its own middlewares in order.
 */
export function limitSignedInUsers(authenticate: RequestHandler, now: () => Date): RequestHandler {
  const perUser = rateLimit(limiter(limits.signedIn, now), (req) =>
    String(callerOf(req).telegramUserId),
  );
  return Router().use(authenticate, perUser);
}
