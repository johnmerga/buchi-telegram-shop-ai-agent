import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validate';
import { AppError } from '../../shared/errors';
import type { Conversation } from './conversations.repo';
import type { ConversationService } from './conversations.service';
import { conversationItem } from './owner.domain';

const shopParams = z.object({ shopId: z.uuid() });
const conversationParams = shopParams.extend({ conversationId: z.uuid() });

/** The owner's **Conversations** screen, with the same **Take over** and **Hand back** as the chat. */
export function createConversationsRouter(deps: {
  conversations: Pick<ConversationService, 'list' | 'takeOver' | 'handBack'>;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { conversations, requireAuth, requireShopOwner } = deps;
  const router = Router();
  const owner = [requireAuth, requireShopOwner];

  router.get('/shops/:shopId/conversations', ...owner, async (req, res) => {
    const list = await conversations.list(parseInput(shopParams, req.params).shopId);
    res.json(list.map(conversationItem));
  });

  const switchMode = (
    action: (shopIds: string[], conversationId: string) => Promise<Conversation | undefined>,
  ): RequestHandler => {
    return async (req, res) => {
      const { shopId, conversationId } = parseInput(conversationParams, req.params);
      const conversation = await action([shopId], conversationId);
      if (!conversation) throw new AppError('NOT_FOUND', 'Conversation not found');
      res.json(conversationItem(conversation));
    };
  };

  router.post(
    '/shops/:shopId/conversations/:conversationId/take-over',
    ...owner,
    switchMode((shopIds, id) => conversations.takeOver(shopIds, id)),
  );
  router.post(
    '/shops/:shopId/conversations/:conversationId/hand-back',
    ...owner,
    switchMode((shopIds, id) => conversations.handBack(shopIds, id)),
  );

  return router;
}
