import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Rejects requests whose header does not match the secret, in constant time. */
export function requireSecretHeader(headerName: string, secret: string): RequestHandler {
  const expected = digest(secret);
  return (req, _res, next) => {
    const received = req.header(headerName);
    if (received === undefined || !timingSafeEqual(digest(received), expected)) {
      next(new AppError('UNAUTHORIZED', `Missing or wrong ${headerName} header`));
      return;
    }
    next();
  };
}
