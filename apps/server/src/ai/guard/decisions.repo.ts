import { and, eq } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { agentDecisions } from '../../db/schema';

type NewDecision = typeof agentDecisions.$inferInsert;

export class DecisionsRepo {
  async insert(tx: Transaction, decision: NewDecision): Promise<string> {
    const [row] = await tx
      .insert(agentDecisions)
      .values(decision)
      .returning({ id: agentDecisions.id });
    if (!row) throw new Error('Insert returned no agent decision');
    return row.id;
  }

  /** Records the owner's answer to a pending decision. Returns false once it was answered. */
  async answer(tx: Transaction, decisionId: string, approved: boolean): Promise<boolean> {
    const updated = await tx
      .update(agentDecisions)
      .set({ ownerStatus: approved ? 'approved' : 'declined' })
      .where(and(eq(agentDecisions.id, decisionId), eq(agentDecisions.ownerStatus, 'pending')))
      .returning({ id: agentDecisions.id });
    return updated.length > 0;
  }
}
