import { z } from 'zod';
import type { CustomerMessages } from '../../../../modules/operations/customer-messages.service';
import { deadlineExtended } from '../../../../modules/operations/operations.domain';
import type { OrderService } from '../../../../modules/orders/orders.service';
import { AppError } from '../../../../shared/errors';
import { addisClockTime } from '../../../../shared/time';
import type { ApprovedAction } from '../../../approvals/owner-approvals.service';
import type { PolicyGuard } from '../../../guard/policy-guard.service';
import { defineTool, type Tool, type ToolResult } from '../../../tool';

export interface DeadlineToolDeps {
  orders: Pick<OrderService, 'get' | 'extendDeadline'>;
  guard: Pick<PolicyGuard, 'checkDeadlineExtension'>;
  customerMessages: Pick<CustomerMessages, 'toOrderCustomer'>;
}

/** A day is the most even an owner can approve in one step. */
const MAX_MINUTES = 24 * 60;

/**
 * Asks the policy guard first: one extension of up to two hours runs at once, and anything more
 * waits for the owner as a pending decision.
 */
export function extendDeadlineTool(deps: DeadlineToolDeps): Tool {
  return defineTool({
    name: 'extend_deadline',
    description:
      'Gives the customer more minutes to pay for an order. Buchi confirms the new time to them. ' +
      'A second extension, or more than the limit, waits for the owner.',
    agents: ['operations'],
    autonomy: 'automatic',
    input: z.object({
      orderId: z.uuid(),
      minutes: z.number().int().min(1).max(MAX_MINUTES),
      reason: z.string().trim().min(1).max(200),
    }),
    handle: async ({ orderId, minutes, reason }, context) => {
      const order = await deps.orders.get(context.shopId, orderId);
      if (order.status !== 'awaiting_payment') {
        throw new AppError('CONFLICT', 'Only an order that waits for payment has a deadline.');
      }
      const { decision, toolResult } = await deps.guard.checkDeadlineExtension(
        context,
        { value: minutes, reason, evidenceIds: [] },
        { orderId, extensionsMade: order.deadlineExtensions },
      );
      if (decision.result !== 'accepted') return toolResult;
      return extendAndConfirm(deps, context.shopId, orderId, decision.value);
    },
  });
}

/** What the owner's approval of a held extension runs: the extension, without the guard. */
export function extendDeadlineApproval(deps: DeadlineToolDeps): ApprovedAction {
  const stored = z.object({ orderId: z.uuid(), value: z.number().int().min(1).max(MAX_MINUTES) });
  return {
    tool: 'extend_deadline',
    run: (proposed, context) => {
      const { orderId, value } = stored.parse(proposed);
      return extendAndConfirm(deps, context.shopId, orderId, value);
    },
  };
}

async function extendAndConfirm(
  deps: DeadlineToolDeps,
  shopId: string,
  orderId: string,
  minutes: number,
): Promise<ToolResult> {
  const deadline = await deps.orders.extendDeadline(shopId, orderId, minutes);
  const told = await deps.customerMessages.toOrderCustomer(
    shopId,
    orderId,
    deadlineExtended(orderId, deadline),
  );
  return {
    status: 'ok',
    output: {
      accepted: minutes,
      newDeadline: addisClockTime(deadline),
      customerTold: told === 'sent',
    },
  };
}
