import type { Request, RequestHandler } from 'express';
import { AppError } from '../../shared/errors';
import type { RateLimiter } from '../../shared/rate-limiter';

/** Refuses a request whose key is over `limiter`'s limit with 429 and a `Retry-After` header. */
export function rateLimit(limiter: RateLimiter, keyOf: (req: Request) => string): RequestHandler {
  return (req, res, next) => {
    const waitMs = limiter.take(keyOf(req));
    if (waitMs === 0) {
      next();
      return;
    }
    res.setHeader('retry-after', String(Math.ceil(waitMs / 1000)));
    next(new AppError('RATE_LIMITED', 'Too many requests. Try again shortly.'));
  };
}
