import type { AiDecision } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { DecisionRow, DecisionsRepo } from '../guard/decisions.repo';
import type { OwnerApprovals } from './owner-approvals.service';

/** The **AI decisions** screen shows this many. Each one is also in the owner's chat. */
const LISTED_DECISIONS = 100;

/**
 * Every policy guard decision with its reason, the owner's private limits, and the evidence the
 * agent cited. A far-area price above the cap is answered with the quote's own buttons in the chat,
 * so only requests that `OwnerApprovals` runs can be decided here.
 */
export class DecisionLog {
  constructor(
    private readonly db: Database,
    private readonly repo: Pick<DecisionsRepo, 'recent'>,
    private readonly approvals: Pick<OwnerApprovals, 'canRun'>,
  ) {}

  async recent(shopId: string): Promise<AiDecision[]> {
    const rows = await withShop(this.db, shopId, (tx) => this.repo.recent(tx, LISTED_DECISIONS));
    return rows.map((row) => this.toItem(row));
  }

  private toItem(row: DecisionRow): AiDecision {
    return {
      id: row.id,
      agent: row.agent,
      tool: row.tool,
      result: row.result,
      reason: row.reason,
      agentReason: row.agentReason,
      proposed: row.proposed,
      limits: row.limits,
      counteroffer: row.counteroffer?.value ?? null,
      evidenceIds: row.evidenceIds,
      ownerStatus: row.ownerStatus,
      ownerCanDecide: row.ownerStatus === 'pending' && this.approvals.canRun(row.tool),
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  }
}
