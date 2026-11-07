import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { paymentReviewActionSchema } from '@buchi/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validate';
import { AppError } from '../../shared/errors';
import type { PaymentRecords } from './payment-records.service';
import type { PaymentReview } from './payment-review.service';

export interface ScreenshotStream {
  contentType: string;
  body: Readable;
}

/** Opens a file that a customer sent in the chat. Telegram is the only implementation. */
export interface ScreenshotFiles {
  open(fileId: string): Promise<ScreenshotStream>;
}

const shopParams = z.object({ shopId: z.uuid() });
const proofParams = shopParams.extend({ proofId: z.uuid() });
const decideParams = proofParams.extend({ action: paymentReviewActionSchema });

/**
 * The owner's **Payment review** screen: the queue, each screenshot, Approve or Reject, and the
 * recent decisions.
 */
export function createPaymentsRouter(deps: {
  records: PaymentRecords;
  review: Pick<PaymentReview, 'decide'>;
  files: ScreenshotFiles;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { records, review, files, requireAuth, requireShopOwner } = deps;
  const router = Router();
  const owner = [requireAuth, requireShopOwner];

  router.get('/shops/:shopId/payment-reviews', ...owner, async (req, res) => {
    res.json(await records.reviewQueue(parseInput(shopParams, req.params).shopId));
  });

  router.get('/shops/:shopId/payment-decisions', ...owner, async (req, res) => {
    res.json(await records.recentDecisions(parseInput(shopParams, req.params).shopId));
  });

  /** Streams the image from Telegram on each request, so Buchi never stores a screenshot. */
  router.get('/shops/:shopId/payment-reviews/:proofId/screenshot', ...owner, async (req, res) => {
    const { shopId, proofId } = parseInput(proofParams, req.params);
    const file = await files.open(await records.screenshotFileId(shopId, proofId));
    res.set({
      'content-type': file.contentType,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    await pipeline(file.body, res);
  });

  /** Runs the same service as the Telegram buttons, so a decision counts once wherever it is made. */
  router.post('/shops/:shopId/payment-reviews/:proofId/:action', ...owner, async (req, res) => {
    const { shopId, proofId, action } = parseInput(decideParams, req.params);
    const result = await review.decide([shopId], proofId, action);
    if (result === 'not_found') throw new AppError('NOT_FOUND', 'No payment waits for review');
    if (result === 'already_decided') throw new AppError('CONFLICT', 'Already decided');
    if (result === 'out_of_stock') {
      throw new AppError('CONFLICT', 'The item sold out after the order was closed');
    }
    res.json({ result });
  });

  return router;
}
