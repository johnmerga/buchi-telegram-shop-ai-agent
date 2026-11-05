import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import type { AuthService } from './auth.service';

const miniAppSignInSchema = z.object({ initData: z.string().min(1) });

export function createAuthRouter(auth: AuthService): Router {
  const router = Router();
  router.post('/auth/mini-app', async (req, res) => {
    const body = miniAppSignInSchema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_FAILED', 'Body needs an initData string');
    res.json(await auth.signInWithMiniApp(body.data.initData));
  });
  return router;
}
