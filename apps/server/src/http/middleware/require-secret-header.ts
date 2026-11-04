import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors';

// Hashing first gives equal-length buffers, so the comparison leaks neither content nor length.
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Rejects requests whose `headerName` header does not equal `secret`, in constant time. */
export function requireSecretHeader(headerName: string, secret: string): RequestHandler {
  const expected = digest(secret);
  return (req, _res, next) => {
    const given = req.get(headerName);
    if (given === undefined || !timingSafeEqual(digest(given), expected)) {
      next(new AppError('UNAUTHORIZED', `Missing or invalid ${headerName} header`));
      return;
    }
    next();
  };
}
