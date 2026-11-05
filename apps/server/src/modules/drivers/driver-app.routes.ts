import { coordinatesSchema } from '@buchi/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { callerOf } from '../../http/caller';
import { parseInput } from '../../http/validate';
import { AppError } from '../../shared/errors';
import type { DispatchService } from './dispatch.service';
import type { DriverBoardService } from './driver-board.service';
import type { SpecialOffers } from './special-offers.service';
import type { TripService } from './trips.service';

const offerParams = z.object({ offerId: z.uuid() });
const jobParams = z.object({ jobId: z.uuid() });
const stopParams = z.object({ stopId: z.uuid() });

/**
 * The driver Mini App's API. The services check that the caller is the shop's driver and that the
 * offer, job, or stop is theirs, the same way the chat buttons do.
 */
export function createDriverAppRouter(deps: {
  board: DriverBoardService;
  dispatch: Pick<DispatchService, 'accept'>;
  specialOffers: Pick<SpecialOffers, 'hold'>;
  trips: Pick<TripService, 'pickedUp' | 'confirmDelivery'>;
  requireAuth: RequestHandler;
}): Router {
  const { board, dispatch, specialOffers, trips, requireAuth } = deps;
  const router = Router();

  router.get('/driver/board', requireAuth, async (req, res) => {
    res.json(await board.board(callerOf(req).telegramUserId));
  });

  router.post('/driver/offers/:offerId/accept', requireAuth, async (req, res) => {
    const { offerId } = parseInput(offerParams, req.params);
    const result = await dispatch.accept(callerOf(req).telegramUserId, offerId);
    if (result === 'not_found') throw new AppError('NOT_FOUND', 'Offer not found');
    res.json({ result });
  });

  /** A far-area offer is held, not accepted: the job is the driver's once the customer pays. */
  router.post('/driver/offers/:offerId/hold', requireAuth, async (req, res) => {
    const { offerId } = parseInput(offerParams, req.params);
    const result = await specialOffers.hold(callerOf(req).telegramUserId, offerId);
    if (result === 'not_found') throw new AppError('NOT_FOUND', 'Offer not found');
    res.json({ result });
  });

  router.post('/driver/jobs/:jobId/picked-up', requireAuth, async (req, res) => {
    const { jobId } = parseInput(jobParams, req.params);
    if (!(await trips.pickedUp(callerOf(req).telegramUserId, jobId))) {
      throw new AppError('NOT_FOUND', 'No accepted job of yours to pick up');
    }
    res.sendStatus(204);
  });

  /** The body is the driver's location, which only feeds the distance check and is not stored. */
  router.post('/driver/stops/:stopId/delivered', requireAuth, async (req, res) => {
    const { stopId } = parseInput(stopParams, req.params);
    const location = parseInput(coordinatesSchema, req.body);
    const result = await trips.confirmDelivery(callerOf(req).telegramUserId, stopId, location);
    if (result.status === 'not_found') {
      throw new AppError('NOT_FOUND', 'No stop of yours that is on its way');
    }
    res.sendStatus(204);
  });

  return router;
}
