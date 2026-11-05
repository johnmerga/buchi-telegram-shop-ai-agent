import type { Transaction } from '../db/client';
import { agentTraces } from '../db/schema';

export type NewTrace = typeof agentTraces.$inferInsert;

export class TracesRepo {
  async insert(tx: Transaction, trace: NewTrace): Promise<void> {
    await tx.insert(agentTraces).values(trace);
  }
}
