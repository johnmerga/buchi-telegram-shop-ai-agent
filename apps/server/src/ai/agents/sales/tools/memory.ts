import { z } from 'zod';
import type { CustomerMemoryService } from '../../../../modules/customers/customer-memory.service';
import type { CustomersService } from '../../../../modules/customers/customers.service';
import type { ConversationService } from '../../../../modules/owner/conversations.service';
import { AppError } from '../../../../shared/errors';
import { defineTool, type Tool } from '../../../tool';
import { customerOf } from './customer';

export interface MemoryToolDeps {
  customers: Pick<CustomersService, 'byTelegramUser'>;
  memory: Pick<CustomerMemoryService, 'remember' | 'forget'>;
  conversations: Pick<ConversationService, 'latestCustomerMessage' | 'forgetTurns'>;
}

export function rememberFactTool(deps: MemoryToolDeps): Tool {
  return defineTool({
    name: 'remember_fact',
    description:
      'Saves a stable fact the customer stated about themselves, such as key "shoe_size" with ' +
      'fact "42", or key "area" with fact "Bole". A new fact under the same key replaces the old one.',
    agents: ['sales'],
    autonomy: 'automatic',
    input: z.object({
      key: z.string().regex(/^[a-z][a-z_]{1,29}$/),
      fact: z.string().trim().min(1).max(200),
    }),
    handle: async ({ key, fact }, context) => {
      const customer = await customerOf(deps.customers, context);
      // The source is the customer's own latest message, recorded by code, never model text.
      const sourceMessage = await deps.conversations.latestCustomerMessage(
        context.shopId,
        customer,
      );
      if (sourceMessage === undefined) {
        throw new AppError('CONFLICT', 'There is no customer message to save a fact from.');
      }
      await deps.memory.remember(context.shopId, customer.id, { key, fact, sourceMessage });
      return { status: 'ok', output: { remembered: key } };
    },
  });
}

export function forgetMyDetailsTool(deps: MemoryToolDeps): Tool {
  return defineTool({
    name: 'forget_my_details',
    description:
      'Deletes every fact saved about the customer and the remembered chat, when they ask Buchi ' +
      'to forget them.',
    agents: ['sales'],
    autonomy: 'automatic',
    input: z.object({}),
    handle: async (_input, context) => {
      const customer = await customerOf(deps.customers, context);
      await deps.memory.forget(context.shopId, customer.id);
      await deps.conversations.forgetTurns(context.shopId, customer);
      return { status: 'ok', output: { forgotten: true } };
    },
  });
}
