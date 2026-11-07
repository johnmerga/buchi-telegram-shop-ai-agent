import { and, asc, desc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { customers, orders, paymentProofs } from '../../db/schema';

export type PaymentProofRow = typeof paymentProofs.$inferSelect;
type NewPaymentProof = typeof paymentProofs.$inferInsert;
type OwnerPaymentDecision = NonNullable<PaymentProofRow['ownerDecision']>;

const waitsForOwner = or(
  eq(paymentProofs.decision, 'review'),
  and(eq(paymentProofs.decision, 'reject'), isNotNull(paymentProofs.reportedAt)),
);
const stillWithOwner = and(waitsForOwner, isNull(paymentProofs.ownerDecision));
/** The opposite of `stillWithOwner`: the owner answered, or the proof never needed them. */
const settled = or(
  isNotNull(paymentProofs.ownerDecision),
  and(
    ne(paymentProofs.decision, 'review'),
    or(ne(paymentProofs.decision, 'reject'), isNull(paymentProofs.reportedAt)),
  ),
);

/** A settled proof with the order and customer that the owner's history shows. */
export interface SettledProofRow {
  proof: PaymentProofRow;
  orderId: string;
  customerName: string;
}

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

  /** Screenshots that wait for the owner, oldest first: unclear ones, and reported rejections. */
  awaitingOwner(tx: Transaction): Promise<PaymentProofRow[]> {
    return tx
      .select()
      .from(paymentProofs)
      .where(stillWithOwner)
      .orderBy(asc(paymentProofs.createdAt));
  }

  /** The newest proofs that no longer wait for the owner, with their order's customer. */
  recentlySettled(tx: Transaction, limit: number): Promise<SettledProofRow[]> {
    return tx
      .select({ proof: paymentProofs, orderId: orders.id, customerName: customers.name })
      .from(paymentProofs)
      .innerJoin(
        orders,
        and(eq(orders.id, paymentProofs.orderId), eq(orders.shopId, paymentProofs.shopId)),
      )
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(settled)
      .orderBy(desc(paymentProofs.createdAt))
      .limit(limit);
  }

  /** Reports a rejected screenshot once, in one statement, so two taps cannot both count. */
  async markReported(tx: Transaction, id: string): Promise<boolean> {
    const updated = await tx
      .update(paymentProofs)
      .set({ reportedAt: sql`now()` })
      .where(
        and(
          eq(paymentProofs.id, id),
          eq(paymentProofs.decision, 'reject'),
          isNull(paymentProofs.reportedAt),
        ),
      )
      .returning({ id: paymentProofs.id });
    return updated.length > 0;
  }

  /** The proof that paid an order, whether Buchi or the owner approved it. */
  async approvedForOrder(tx: Transaction, orderId: string): Promise<PaymentProofRow | undefined> {
    const [row] = await tx
      .select()
      .from(paymentProofs)
      .where(
        and(
          eq(paymentProofs.orderId, orderId),
          or(eq(paymentProofs.decision, 'approve'), eq(paymentProofs.ownerDecision, 'approved')),
        ),
      )
      .orderBy(desc(paymentProofs.createdAt))
      .limit(1);
    return row;
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
      .where(and(eq(paymentProofs.id, id), stillWithOwner))
      .returning({ id: paymentProofs.id });
    return updated.length > 0;
  }
}
