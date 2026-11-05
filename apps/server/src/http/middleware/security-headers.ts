import type { RequestHandler } from 'express';

/**
 * Headers for every response. API responses are data that no page should run or embed, so their
 * policy allows nothing; the web app's pages replace it with their own.
 */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('x-content-type-options', 'nosniff');
  // OpenStreetMap's tile policy asks for a referrer, so the pages' origin still goes with tiles.
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('strict-transport-security', 'max-age=31536000');
  next();
};
