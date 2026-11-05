import type { ApprovedAction } from '../../approvals/owner-approvals.service';
import type { Tool } from '../../tool';
import { askDataTool, type AskDataDeps } from './tools/ask-data';
import { proposeRuleApproval, proposeRuleTool, type ProposeRuleDeps } from './tools/propose-rule';

export type OwnerAssistantToolDeps = ProposeRuleDeps & AskDataDeps;

/**
 * The tools of the owner assistant's chat, in the order the model sees them, and what an owner's
 * **Confirm** runs for the proposals it holds.
 */
export function ownerAssistantTools(deps: OwnerAssistantToolDeps): {
  tools: Tool[];
  approvals: ApprovedAction[];
} {
  const proposeRule = proposeRuleTool(deps);
  return {
    tools: [proposeRule, askDataTool(deps)],
    approvals: [proposeRuleApproval(proposeRule, deps)],
  };
}
