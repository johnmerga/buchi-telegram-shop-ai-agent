import { and, asc, eq } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { agentDecisions } from '../../db/schema';

type NewDecision = typeof agentDecisions.$inferInsert;
export type DecisionRow = typeof agentDecisions.$inferSelect;

export class DecisionsRepo {
  async insert(tx: Transaction, decision: NewDecision): Promise<void> {
    await tx.insert(agentDecisions).values(decision);
  }

  /** The requests one agent run left for the owner, in the order the agent made them. */
  pendingOfRun(tx: Transaction, runId: string): Promise<DecisionRow[]> {
    return tx
      .select()
      .from(agentDecisions)
      .where(and(eq(agentDecisions.runId, runId), eq(agentDecisions.ownerStatus, 'pending')))
      .orderBy(asc(agentDecisions.createdAt));
  }

  /**
   * Records the owner's answer only while the request is pending, in one statement, so a second
   * tap, even a parallel one, finds nothing to decide.
   */
  async decide(
    tx: Transaction,
    decisionId: string,
    answer: { status: 'approved' | 'declined'; decidedBy: number; decidedAt: Date },
  ): Promise<DecisionRow | undefined> {
    const [row] = await tx
      .update(agentDecisions)
      .set({ ownerStatus: answer.status, decidedBy: answer.decidedBy, decidedAt: answer.decidedAt })
      .where(and(eq(agentDecisions.id, decisionId), eq(agentDecisions.ownerStatus, 'pending')))
      .returning();
    return row;
  }

  async find(tx: Transaction, decisionId: string): Promise<DecisionRow | undefined> {
    const [row] = await tx.select().from(agentDecisions).where(eq(agentDecisions.id, decisionId));
    return row;
  }
}
