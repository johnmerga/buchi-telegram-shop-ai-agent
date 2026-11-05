import { Router } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validate';
import { AppError } from '../../shared/errors';
import type { AuthService } from './auth.service';
import { loginWidgetDataSchema } from './login-widget.domain';

const miniAppSignInSchema = z.object({ initData: z.string().min(1) });

/** `botUsername` is public: the browser's Login Widget needs it to show the right bot. */
export function createAuthRouter(auth: AuthService, botUsername: string): Router {
  const router = Router();
  router.post('/auth/mini-app', async (req, res) => {
    const body = miniAppSignInSchema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_FAILED', 'Body needs an initData string');
    res.json(await auth.signInWithMiniApp(body.data.initData));
  });

  router.get('/auth/login-widget', (_req, res) => {
    res.json({ botUsername });
  });

  router.post('/auth/login-widget', async (req, res) => {
    res.json(await auth.signInWithLoginWidget(parseInput(loginWidgetDataSchema, req.body)));
  });
  return router;
}
