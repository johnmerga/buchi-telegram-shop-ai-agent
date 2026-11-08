import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { agentDecisions } from '../../db/schema';

type NewDecision = typeof agentDecisions.$inferInsert;
export type DecisionRow = typeof agentDecisions.$inferSelect;

export class DecisionsRepo {
  async insert(tx: Transaction, decision: NewDecision): Promise<string> {
    const [row] = await tx
      .insert(agentDecisions)
      .values(decision)
      .returning({ id: agentDecisions.id });
    if (!row) throw new Error('Insert returned no agent decision');
    return row.id;
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
   * Whether the same tool already waits for the owner about this order. The lock, held to the end
   * of the transaction, makes two requests that arrive together check one after the other.
   */
  async hasPendingForOrder(tx: Transaction, tool: string, orderId: string): Promise<boolean> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${tool}:${orderId}`}))`);
    const [row] = await tx
      .select({ id: agentDecisions.id })
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.tool, tool),
          eq(agentDecisions.ownerStatus, 'pending'),
          sql`${agentDecisions.proposed} ->> 'orderId' = ${orderId}`,
        ),
      )
      .limit(1);
    return row !== undefined;
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

  /** The latest decisions, with requests that still wait for the owner first. */
  recent(tx: Transaction, limit: number): Promise<DecisionRow[]> {
    return tx
      .select()
      .from(agentDecisions)
      .orderBy(
        // A decision without an owner status compares as null, which `desc` would put first.
        desc(sql`coalesce(${agentDecisions.ownerStatus} = 'pending', false)`),
        desc(agentDecisions.createdAt),
      )
      .limit(limit);
  }

  async find(tx: Transaction, decisionId: string): Promise<DecisionRow | undefined> {
    const [row] = await tx.select().from(agentDecisions).where(eq(agentDecisions.id, decisionId));
    return row;
  }
}
