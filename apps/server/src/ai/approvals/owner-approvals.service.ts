import type { Logger } from 'pino';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { OwnerAlerts } from '../../modules/owner/owner-alerts.service';
import { AppError } from '../../shared/errors';
import type { DecisionRow, DecisionsRepo } from '../guard/decisions.repo';
import type { Tool, ToolCallContext, ToolResult } from '../tool';
import { approvalButtons, approvalRequest } from './approvals.domain';
import type { ApprovalChoice } from './approvals.schemas';

/** What runs once the owner approves a held decision of one tool, with the decision's input. */
export interface ApprovedAction {
  tool: string;
  run(proposed: Record<string, unknown>, context: ToolCallContext): Promise<ToolResult>;
}

/** An `owner_confirms` tool's handler is its approved action, run with the stored input. */
export function approvedActionOf(tool: Pick<Tool, 'name' | 'parse'>): ApprovedAction {
  return {
    tool: tool.name,
    run: (proposed, context) => {
      const parsed = tool.parse(proposed);
      if (!parsed.success) throw new Error(`The stored input of ${tool.name} is invalid`);
      return parsed.run(context);
    },
  };
}

export type ApprovalResult =
  | { status: 'approved'; result: ToolResult }
  | { status: 'declined' | 'already_decided' | 'not_found' };

interface Owner {
  telegramUserId: number;
  shopIds: string[];
}

/**
 * The owner-confirms path: each pending decision becomes an owner message with **Approve** and
 * **Decline**. Approval runs the stored input through the tool's action once. The decision is
 * claimed before it runs, so a double tap, even a parallel one, runs it at most once.
 */
export class OwnerApprovals {
  private readonly actions = new Map<string, ApprovedAction>();

  constructor(
    private readonly db: Database,
    private readonly repo: DecisionsRepo,
    actions: readonly ApprovedAction[],
    private readonly alerts: Pick<OwnerAlerts, 'send'>,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {
    for (const action of actions) this.actions.set(action.tool, action);
  }

  /** Whether approving a request of this tool runs an action here, rather than in its own flow. */
  canRun(tool: string): boolean {
    return this.actions.has(tool);
  }

  /** Sends the owners every request that one agent run left pending. */
  async requestFor(shopId: string, runId: string): Promise<void> {
    const pending = await withShop(this.db, shopId, (tx) => this.repo.pendingOfRun(tx, runId));
    for (const decision of pending) {
      await this.alerts.send(shopId, approvalRequest(decision), approvalButtons(decision.id));
    }
  }

  async decide(owner: Owner, decisionId: string, choice: ApprovalChoice): Promise<ApprovalResult> {
    const status = choice === 'approve' ? 'approved' : 'declined';
    for (const shopId of owner.shopIds) {
      const outcome = await withShop(this.db, shopId, async (tx) => {
        // A request of another flow, such as a far-area price, is answered with that flow's buttons.
        const found = await this.repo.find(tx, decisionId);
        if (!found || !this.canRun(found.tool)) return undefined;
        const decided = await this.repo.decide(tx, decisionId, {
          status,
          decidedBy: owner.telegramUserId,
          decidedAt: this.now(),
        });
        return decided ? { decided } : 'already_decided';
      });
      if (outcome === undefined) continue;
      if (outcome === 'already_decided') return { status: outcome };
      if (status === 'declined') return { status };
      return { status, result: await this.run(shopId, owner, outcome.decided) };
    }
    return { status: 'not_found' };
  }

  /** An action that no longer applies, such as a bonus for a job a driver took, says why. */
  private async run(shopId: string, owner: Owner, decision: DecisionRow): Promise<ToolResult> {
    const action = this.actions.get(decision.tool);
    if (!action) throw new Error(`No approved action for ${decision.tool}`);
    const context: ToolCallContext = {
      shopId,
      runId: decision.runId,
      agent: decision.agent,
      tool: decision.tool,
      actor: { kind: 'owner', telegramUserId: owner.telegramUserId },
    };
    try {
      return await action.run(decision.proposed, context);
    } catch (err) {
      if (err instanceof AppError) return { status: 'error', error: err.message };
      this.logger.error({ err, shopId, tool: decision.tool }, 'approved action failed');
      return { status: 'error', error: 'It failed for an internal reason.' };
    }
  }
}
