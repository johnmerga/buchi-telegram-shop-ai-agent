import { and, eq, isNull } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { paymentProofs } from '../../db/schema';

export type PaymentProofRow = typeof paymentProofs.$inferSelect;
export type NewPaymentProof = typeof paymentProofs.$inferInsert;
export type OwnerPaymentDecision = NonNullable<PaymentProofRow['ownerDecision']>;

/** Every query runs inside `withShop`, so row-level security limits it to one shop. */
export class PaymentProofsRepo {
  async insert(tx: Transaction, proof: NewPaymentProof): Promise<PaymentProofRow> {
    const [row] = await tx.insert(paymentProofs).values(proof).returning();
    if (!row) throw new Error('Insert returned no payment proof');
    return row;
  }

  async find(tx: Transaction, id: string): Promise<PaymentProofRow | undefined> {
    const [row] = await tx.select().from(paymentProofs).where(eq(paymentProofs.id, id));
    return row;
  }

  /** The earlier proofs of an order, which decide R1's second chance and what is still due. */
  forOrder(tx: Transaction, orderId: string): Promise<PaymentProofRow[]> {
    return tx.select().from(paymentProofs).where(eq(paymentProofs.orderId, orderId));
  }

  /** Records the owner's decision once, in one statement, so two taps cannot both count. */
  async decideByOwner(
    tx: Transaction,
    id: string,
    decision: OwnerPaymentDecision,
  ): Promise<boolean> {
    const updated = await tx
      .update(paymentProofs)
      .set({ ownerDecision: decision })
      .where(
        and(
          eq(paymentProofs.id, id),
          eq(paymentProofs.decision, 'review'),
          isNull(paymentProofs.ownerDecision),
        ),
      )
      .returning({ id: paymentProofs.id });
    return updated.length > 0;
  }
}
