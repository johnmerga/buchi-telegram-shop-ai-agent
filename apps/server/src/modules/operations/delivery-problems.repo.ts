import { and, eq, isNull } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { deliveryProblems } from '../../db/schema';
import type { ProblemKind } from './operations.schemas';

export class DeliveryProblemsRepo {
  /** Records the first report of an order only, and returns false for any later one. */
  async insert(
    tx: Transaction,
    problem: { shopId: string; orderId: string; kind: ProblemKind },
  ): Promise<boolean> {
    const inserted = await tx
      .insert(deliveryProblems)
      .values(problem)
      .onConflictDoNothing()
      .returning({ id: deliveryProblems.id });
    return inserted.length > 0;
  }

  /** Sets the wanted size of a wrong-size report once. */
  async setWantedSize(tx: Transaction, orderId: string, size: string): Promise<boolean> {
    const updated = await tx
      .update(deliveryProblems)
      .set({ wantedSize: size })
      .where(
        and(
          eq(deliveryProblems.orderId, orderId),
          eq(deliveryProblems.kind, 'wrong_size'),
          isNull(deliveryProblems.wantedSize),
        ),
      )
      .returning({ id: deliveryProblems.id });
    return updated.length > 0;
  }
}
