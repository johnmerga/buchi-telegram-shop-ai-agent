import { z } from 'zod';
import type { CustomersService } from '../../../../modules/customers/customers.service';
import type { ConversationService } from '../../../../modules/owner/conversations.service';
import { defineTool, type Tool } from '../../../tool';
import { customerOf } from './customer';

export interface HumanToolDeps {
  customers: Pick<CustomersService, 'byTelegramUser'>;
  conversations: Pick<ConversationService, 'requestHuman'>;
}

export function requestHumanTool(deps: HumanToolDeps): Tool {
  return defineTool({
    name: 'request_human',
    description:
      "Hands the chat to the shop's owner, who answers the customer in person from now on. Use " +
      'it when the customer asks for a person or seems upset. Give a one-sentence reason.',
    agents: ['sales'],
    autonomy: 'automatic',
    input: z.object({ reason: z.string().trim().min(3).max(200) }),
    handle: async ({ reason }, context) => {
      const customer = await customerOf(deps.customers, context);
      await deps.conversations.requestHuman(context.shopId, customer, reason);
      return { status: 'ok', output: { handedOver: true } };
    },
  });
}
