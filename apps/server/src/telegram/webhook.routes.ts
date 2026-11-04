import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../shared/errors';
import { requireSecretHeader } from '../http/middleware/require-secret-header';
import type { TelegramIngress } from './ingress';

const updateSchema = z.looseObject({ update_id: z.number().int().nonnegative() });

export function createTelegramWebhookRouter(deps: {
  secret: string;
  ingress: TelegramIngress;
}): Router {
  const router = Router();
  router.post(
    '/telegram/webhook',
    requireSecretHeader('x-telegram-bot-api-secret-token', deps.secret),
    async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_FAILED', 'Body is not a Telegram update');
      }
      await deps.ingress.receive(parsed.data);
      res.sendStatus(200);
    },
  );
  return router;
}
