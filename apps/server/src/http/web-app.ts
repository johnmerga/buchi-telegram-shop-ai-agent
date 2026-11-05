import { join } from 'node:path';
import express, { Router } from 'express';
import { AppError } from '../shared/errors';

/** Each Mini App is its own page with its own bundle, so a role loads only its own code. */
const roles = ['owner', 'driver', 'customer'] as const;

/**
 * Serves the built web app from `distDir` on the API's origin, so the bearer token never crosses
 * origins. Pages live under `/app`, apart from the API's paths, and every path under a role falls
 * back to that role's page for client-side routing.
 */
export function createWebAppRouter(distDir: string): Router {
  const router = Router();

  // Vite puts a content hash in every asset name, so a cached asset never goes stale.
  router.use('/app/assets', express.static(join(distDir, 'assets'), { immutable: true, maxAge: '1y' }));

  for (const role of roles) {
    router.get([`/app/${role}`, `/app/${role}/{*path}`], (_req, res, next) => {
      res.setHeader('cache-control', 'no-cache');
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
