import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { OrderService } from '../orders/orders.service';
import { reportedCaption } from './payment-messages.domain';
import type { PaymentNotifier } from './payment-notifier.service';
import type { PaymentProofsRepo } from './payment-proofs.repo';
import { reviewCallbackData } from './payments.schemas';

/**
 * A customer's **Report a problem** on a rejected screenshot. It puts the screenshot in the owner's
 * payment review, where the usual **Approve** and **Reject** decide it.
 */
export class PaymentReports {
  constructor(
    private readonly db: Database,
    private readonly proofs: PaymentProofsRepo,
    private readonly orders: Pick<OrderService, 'getForCustomer'>,
    private readonly notifier: Pick<PaymentNotifier, 'toOwners'>,
  ) {}

  /**
   * Only the order's own customer can report it, and only once. Returns false when there is nothing
   * to report: another customer's order, or a payment that was not rejected or is already reported.
   */
  async report(telegramUserId: number, orderId: string): Promise<boolean> {
    const order = await this.orders
      .getForCustomer(telegramUserId, orderId)
      .catch((err: unknown) => {
        if (err instanceof AppError && err.code === 'NOT_FOUND') return undefined;
        throw err;
      });
    if (order?.status !== 'payment_rejected') return false;
    const { shopId } = order;
    const proof = await withShop(this.db, shopId, async (tx) => {
      const rejected = (await this.proofs.forOrder(tx, orderId)).find(
        (p) => p.decision === 'reject',
      );
      return rejected && (await this.proofs.markReported(tx, rejected.id)) ? rejected : undefined;
    });
    if (!proof) return false;

    const caption = reportedCaption({
      orderId,
      total: order.total,
      reasons: proof.reasons,
      receipt:
        proof.amount !== null && proof.provider !== null && proof.txRef !== null
          ? { amount: proof.amount, provider: proof.provider, txRef: proof.txRef }
          : undefined,
      bank: proof.bankCheck,
    });
    await this.notifier.toOwners(shopId, orderId, { text: caption }, [
      { text: '✅ Approve', data: reviewCallbackData('approve', proof.id) },
      { text: '❌ Reject', data: reviewCallbackData('reject', proof.id) },
    ]);
    return true;
  }
}
