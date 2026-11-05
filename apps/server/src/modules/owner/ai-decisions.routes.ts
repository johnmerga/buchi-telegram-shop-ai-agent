import { approvalChoiceSchema, type ApprovalOutcome } from '@buchi/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { DecisionLog } from '../../ai/approvals/decision-log.service';
import type { ApprovalResult, OwnerApprovals } from '../../ai/approvals/owner-approvals.service';
import { callerOf } from '../../http/caller';
import { parseInput } from '../../http/validate';
import { AppError } from '../../shared/errors';

const shopParams = z.object({ shopId: z.uuid() });
const decideParams = shopParams.extend({ decisionId: z.uuid(), choice: approvalChoiceSchema });

function outcomeOf(result: ApprovalResult): ApprovalOutcome {
  switch (result.status) {
    case 'approved':
      return {
        status: 'approved',
        error: result.result.status === 'error' ? result.result.error : null,
      };
    case 'declined':
    case 'already_decided':
      return { status: result.status, error: null };
    case 'not_found':
      throw new AppError('NOT_FOUND', 'Decision not found');
  }
}

/** The owner's **AI decisions** screen, with the same **Approve** and **Decline** as the chat. */
export function createAiDecisionsRouter(deps: {
  log: DecisionLog;
  approvals: Pick<OwnerApprovals, 'decide'>;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { log, approvals, requireAuth, requireShopOwner } = deps;
  const router = Router();
  const owner = [requireAuth, requireShopOwner];

  router.get('/shops/:shopId/ai-decisions', ...owner, async (req, res) => {
    res.json(await log.recent(parseInput(shopParams, req.params).shopId));
  });

  /** The claim inside `decide` makes a dashboard tap and a chat tap count once between them. */
  router.post('/shops/:shopId/ai-decisions/:decisionId/:choice', ...owner, async (req, res) => {
    const { shopId, decisionId, choice } = parseInput(decideParams, req.params);
    const owner = { telegramUserId: callerOf(req).telegramUserId, shopIds: [shopId] };
    res.json(outcomeOf(await approvals.decide(owner, decisionId, choice)));
  });

  return router;
}
