import { approvedActionOf, type ApprovedAction } from '../../approvals/owner-approvals.service';
import type { Tool } from '../../tool';
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
    startExchangeTool(deps),
    proposeRefundTool(deps),
    proposeRestockTool(deps),
    proposeBonusTool(deps),
    escalateTool(deps),
  ];
}

/** What an owner's approval runs for each operations decision: an `owner_confirms` tool's handler. */
export function operationsApprovals(tools: readonly Tool[]): ApprovedAction[] {
  return tools.filter((tool) => tool.autonomy === 'owner_confirms').map(approvedActionOf);
}
