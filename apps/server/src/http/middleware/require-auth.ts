import type { RequestHandler } from 'express';
import type { Caller } from '../../modules/auth/auth.service';
import { AppError } from '../../shared/errors';

const bearerPattern = /^Bearer\s+(\S+)$/i;

/** Accepts only requests with a valid `Authorization: Bearer <token>` header and sets `req.caller`. */
export function requireAuth(verifyToken: (token: string) => Promise<Caller>): RequestHandler {
  return async (req, _res, next) => {
    const token = bearerPattern.exec(req.get('authorization') ?? '')?.[1];
    if (token === undefined) throw new AppError('UNAUTHORIZED', 'Missing bearer token');
    req.caller = await verifyToken(token);
    next();
  };
}
