import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { CustomersService } from '../customers/customers.service';
import type { OrderService } from '../orders/orders.service';
import { paymentConfirmed, paymentDeclinedByOwner } from './payment-messages.domain';
import type { PaymentNotifier } from './payment-notifier.service';
import type { PaymentProofRow, PaymentProofsRepo } from './payment-proofs.repo';
import type { PaymentRefsRepo } from './payment-refs.repo';
import type { ReviewAction } from './payments.schemas';
import type { RiskService } from './risk.service';

export type ReviewResult = 'approved' | 'rejected' | 'not_found' | 'already_decided';

/** The owner's **Approve** and **Reject** buttons on a payment that Buchi could not decide. */
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
    if (proof?.decision !== 'review') return 'not_found';
    if (proof.ownerDecision !== null) return 'already_decided';

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
    await withShop(this.db, shopId, (tx) =>
      this.proofs.decideByOwner(tx, proof.id, action === 'approve' ? 'approved' : 'rejected'),
    );

    const order = await this.orders.get(shopId, orderId);
    const customer = await this.customers.get(shopId, order.customerId);
    if (action === 'approve') {
      await this.notifier.toCustomer(customer.telegramUserId, paymentConfirmed(orderId));
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
