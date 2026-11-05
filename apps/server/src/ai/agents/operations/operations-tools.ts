import { approvedActionOf, type ApprovedAction } from '../../approvals/owner-approvals.service';
import type { Tool } from '../../tool';
import {
  extendDeadlineApproval,
  extendDeadlineTool,
  type DeadlineToolDeps,
} from './tools/deadline';
import { rescheduleDeliveryTool, saveAreaNoteTool, type DeliveryToolDeps } from './tools/delivery';
import { startExchangeTool, type ExchangeToolDeps } from './tools/exchange';
import {
  messageCustomerTool,
  messageDriverTool,
  updateEtaTool,
  type MessageToolDeps,
} from './tools/messages';
import {
  escalateTool,
  proposeBonusTool,
  proposeRefundTool,
  proposeRestockTool,
  type ProposalToolDeps,
} from './tools/proposals';

export type OperationsToolDeps = MessageToolDeps &
  DeliveryToolDeps &
  DeadlineToolDeps &
  ExchangeToolDeps &
  ProposalToolDeps;

/** Every tool of the operations agent, in the order the model sees them. */
export function operationsTools(deps: OperationsToolDeps): Tool[] {
  return [
    messageCustomerTool(deps),
    messageDriverTool(deps),
    updateEtaTool(deps),
    rescheduleDeliveryTool(deps),
    saveAreaNoteTool(deps),
    extendDeadlineTool(deps),
    startExchangeTool(deps),
    proposeRefundTool(deps),
    proposeRestockTool(deps),
    proposeBonusTool(deps),
    escalateTool(deps),
  ];
}

/**
 * What an owner's approval runs for each operations decision: an `owner_confirms` tool's own
 * handler, and the extension that the guard held for the owner.
 */
export function operationsApprovals(
  tools: readonly Tool[],
  deps: DeadlineToolDeps,
): ApprovedAction[] {
  return [
    ...tools.filter((tool) => tool.autonomy === 'owner_confirms').map(approvedActionOf),
    extendDeadlineApproval(deps),
  ];
}
