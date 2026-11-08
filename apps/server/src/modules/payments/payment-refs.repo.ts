import type { PaymentProvider } from '@buchi/shared';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { paymentRefs } from '../../db/schema';
import { referenceKey } from './payments.domain';

/**
 * Platform-wide: rule R6 compares references across every shop, so it uses no shop context. It
 * stores each reference by its key, so a misread look-alike letter still finds the claim.
 */
export class PaymentRefsRepo {
  constructor(private readonly db: Database) {}

  /**
   * Claims the reference for the order and returns the ID of the order that holds it. The unique
   * constraint decides between parallel claims, so exactly one order wins.
   */
  async claim(provider: PaymentProvider, reference: string, orderId: string): Promise<string> {
    const txRef = referenceKey(reference);
    const [claimed] = await this.db
      .insert(paymentRefs)
      .values({ provider, txRef, orderId })
      .onConflictDoNothing()
      .returning({ orderId: paymentRefs.orderId });
    if (claimed) return claimed.orderId;
    // A separate statement, so it sees a claim that committed while the insert waited for it.
    const [holder] = await this.db
      .select({ orderId: paymentRefs.orderId })
      .from(paymentRefs)
      .where(and(eq(paymentRefs.provider, provider), eq(paymentRefs.txRef, txRef)));
    if (!holder) throw new Error('A conflicting payment reference disappeared');
    return holder.orderId;
  }

  /** Frees a rejected payment's reference, so its rightful order can still use it. */
  async release(provider: PaymentProvider, reference: string, orderId: string): Promise<void> {
    const txRef = referenceKey(reference);
    await this.db
      .delete(paymentRefs)
      .where(
        and(
          eq(paymentRefs.provider, provider),
          eq(paymentRefs.txRef, txRef),
          eq(paymentRefs.orderId, orderId),
        ),
      );
  }
}
