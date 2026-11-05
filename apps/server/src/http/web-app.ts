import { join } from 'node:path';
import express, { Router } from 'express';
import { AppError } from '../shared/errors';

/** Each Mini App is its own page with its own bundle, so a role loads only its own code. */
const roles = ['owner', 'driver', 'customer'] as const;
type Role = (typeof roles)[number];

/**
 * The pages' content security policy. Telegram's Mini App script comes from telegram.org and adds
 * `<style>` elements when Telegram Web restyles the page. Map tiles come from OpenStreetMap, and payment
 * screenshots are object URLs. Telegram Web shows Mini Apps in an iframe on web.telegram.org.
 * Only the owner page signs in with the Login Widget, whose script runs its callback with `eval`
 * and shows its button in an iframe from oauth.telegram.org.
 */
function contentSecurityPolicy(role: Role): string {
  const loginWidget = role === 'owner';
  return [
    "default-src 'self'",
    `script-src 'self' https://telegram.org${loginWidget ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "connect-src 'self'",
    `frame-src ${loginWidget ? 'https://oauth.telegram.org' : "'none'"}`,
    "frame-ancestors 'self' https://web.telegram.org",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Serves the built web app from `distDir` on the API's origin, so the bearer token never crosses
 * origins. Pages live under `/app`, apart from the API's paths, and every path under a role falls
 * back to that role's page for client-side routing.
 */
export function createWebAppRouter(distDir: string): Router {
  const router = Router();

  // Vite puts a content hash in every asset name, so a cached asset never goes stale.
  router.use(
    '/app/assets',
    express.static(join(distDir, 'assets'), { immutable: true, maxAge: '1y' }),
  );

  for (const role of roles) {
    router.get([`/app/${role}`, `/app/${role}/{*path}`], (_req, res, next) => {
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('content-security-policy', contentSecurityPolicy(role));
      res.sendFile(join(distDir, role, 'index.html'), (err) => {
        if (err) next(new AppError('NOT_FOUND', 'The web app is not built'));
      });
    });
  }

  router.get('/', (_req, res) => {
    res.redirect('/app/owner/');
  });
  return router;
}
