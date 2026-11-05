import type { Request } from 'express';
import type { Caller } from '../modules/auth/auth.service';

declare global {
  // Express exposes its Request type for augmentation only through this global namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. */
      caller?: Caller;
    }
  }
}

/** The caller of a route behind `requireAuth`. */
export function callerOf(req: Request): Caller {
  if (req.caller === undefined) throw new Error('requireAuth must run before this handler');
  return req.caller;
}
