import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { CustomersService } from '../customers/customers.service';
import type { OrderService } from '../orders/orders.service';
import { paymentConfirmed, paymentDeclinedByOwner } from './payment-messages.domain';
import type { PaymentNotifier } from './payment-notifier.service';
import type { PaymentProofRow, PaymentProofsRepo } from './payment-proofs.repo';
import type { PaymentRefsRepo } from './payment-refs.repo';
import type { ReviewAction } from './payments.schemas';
import type { RiskService } from './risk.service';

export type ReviewResult =
  'approved' | 'rejected' | 'out_of_stock' | 'not_found' | 'already_decided';

/**
 * The owner's **Approve** and **Reject** buttons on a payment that Buchi could not decide, or on a
 * rejected payment that the customer reported.
 */
export class PaymentReview {
  constructor(
    private readonly db: Database,
    private readonly proofs: PaymentProofsRepo,
    private readonly refs: PaymentRefsRepo,
    private readonly risk: RiskService,
    private readonly orders: OrderService,
    private readonly customers: Pick<CustomersService, 'get'>,
    private readonly notifier: PaymentNotifier,
  ) {}

  async decide(
    ownerShopIds: string[],
    proofId: string,
    action: ReviewAction,
  ): Promise<ReviewResult> {
    const proof = await this.findInOwnedShop(ownerShopIds, proofId);
    const reported = proof?.decision === 'reject' && proof.reportedAt !== null;
    if (!proof || (proof.decision !== 'review' && !reported)) return 'not_found';
    if (proof.ownerDecision !== null) return 'already_decided';
    if (!reported) return this.decideUnclear(proof, action);
    return action === 'approve' ? this.approveReported(proof) : this.rejectReported(proof);
  }

  /** The order waits in `needs_review`, and the owner's answer moves it like Buchi's would. */
  private async decideUnclear(proof: PaymentProofRow, action: ReviewAction): Promise<ReviewResult> {
    const { shopId, orderId } = proof;
    const moved = await this.orders.transitionIfStill(
      shopId,
      orderId,
      'needs_review',
      action === 'approve' ? 'payment_approved' : 'payment_rejected',
      'owner',
      action === 'approve' ? 'Owner approved the payment' : 'Owner rejected the payment',
    );
    if (!moved) return 'already_decided';
    await this.recordDecision(proof, action);

    const { order, customer } = await this.partiesOf(proof);
    if (action === 'approve') {
      await this.notifier.toCustomer(customer.telegramUserId, paymentConfirmed(order));
      return 'approved';
    }
    if (proof.provider !== null && proof.txRef !== null) {
      await this.refs.release(proof.provider, proof.txRef, orderId);
    }
    await this.risk.record(shopId, 'owner_rejected', {
      telegramUserId: customer.telegramUserId,
      phone: customer.phone,
    });
    await this.notifier.toCustomer(customer.telegramUserId, paymentDeclinedByOwner(orderId));
    return 'rejected';
  }

  /**
   * The rejection released the order's stock and its reference, so approval sells the items again
   * only if they are still free, and claims the reference back.
   */
  private async approveReported(proof: PaymentProofRow): Promise<ReviewResult> {
    const { shopId, orderId } = proof;
    let moved: boolean;
    try {
      moved = await this.orders.transitionIfStill(
        shopId,
        orderId,
        'payment_rejected',
        'reported_payment_approved',
        'owner',
        'Owner approved a reported payment',
      );
    } catch (err) {
      // The status is checked first, so the only conflict left is an item that sold out meanwhile.
      if (err instanceof AppError && err.code === 'CONFLICT') return 'out_of_stock';
      throw err;
    }
    if (!moved) return 'already_decided';
    await this.recordDecision(proof, 'approve');
    if (proof.provider !== null && proof.txRef !== null) {
      await this.refs.claim(proof.provider, proof.txRef, orderId);
    }
    const { order, customer } = await this.partiesOf(proof);
    await this.notifier.toCustomer(customer.telegramUserId, paymentConfirmed(order));
    return 'approved';
  }

  /** The order stays closed. Buchi already recorded the risk signal when it rejected the payment. */
  private async rejectReported(proof: PaymentProofRow): Promise<ReviewResult> {
    if (!(await this.recordDecision(proof, 'reject'))) return 'already_decided';
    const { customer } = await this.partiesOf(proof);
    await this.notifier.toCustomer(customer.telegramUserId, paymentDeclinedByOwner(proof.orderId));
    return 'rejected';
  }

  private recordDecision(proof: PaymentProofRow, action: ReviewAction): Promise<boolean> {
    return withShop(this.db, proof.shopId, (tx) =>
      this.proofs.decideByOwner(tx, proof.id, action === 'approve' ? 'approved' : 'rejected'),
    );
  }

  /** The proof's order, which shapes the customer's message, and the customer who receives it. */
  private async partiesOf(proof: PaymentProofRow) {
    const order = await this.orders.get(proof.shopId, proof.orderId);
    return { order, customer: await this.customers.get(proof.shopId, order.customerId) };
  }

  /** Row-level security finds the proof only in a shop that the owner owns. */
  private async findInOwnedShop(
    ownerShopIds: string[],
    proofId: string,
  ): Promise<PaymentProofRow | undefined> {
    for (const shopId of ownerShopIds) {
      const found = await withShop(this.db, shopId, (tx) => this.proofs.find(tx, proofId));
      if (found) return found;
    }
    return undefined;
  }
}
