import type { Transaction } from '../../db/client';
import { agentDecisions } from '../../db/schema';

type NewDecision = typeof agentDecisions.$inferInsert;

export class DecisionsRepo {
  async insert(tx: Transaction, decision: NewDecision): Promise<void> {
    await tx.insert(agentDecisions).values(decision);
  }
}
