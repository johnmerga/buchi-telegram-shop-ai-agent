import { receiptFieldsSchema, type PaymentProvider, type PaymentReviewItem } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { CustomersService } from '../customers/customers.service';
import { orderReference } from '../orders/orders.domain';
import type { OrderService } from '../orders/orders.service';
import type { PaymentProofRow, PaymentProofsRepo } from './payment-proofs.repo';
import type { RiskService } from './risk.service';

/** How an order was paid, for the sales ledger. Empty when the owner approved an unread receipt. */
interface PaidWith {
  provider: PaymentProvider | null;
  txRef: string | null;
  bankVerified: boolean;
}

/** Read-only views of payment proofs: the owner's review queue, its screenshots, and the ledger. */
export class PaymentRecords {
  constructor(
    private readonly db: Database,
    private readonly proofs: PaymentProofsRepo,
    private readonly orders: Pick<OrderService, 'get'>,
    private readonly customers: Pick<CustomersService, 'get'>,
    private readonly risk: Pick<RiskService, 'isHighRisk'>,
  ) {}

  async reviewQueue(shopId: string): Promise<PaymentReviewItem[]> {
    const waiting = await withShop(this.db, shopId, (tx) => this.proofs.awaitingOwner(tx));
    return Promise.all(waiting.map((proof) => this.reviewItem(shopId, proof)));
  }

  /** The Telegram file ID of a proof's screenshot. The image itself is never stored. */
  async screenshotFileId(shopId: string, proofId: string): Promise<string> {
    const proof = await withShop(this.db, shopId, (tx) => this.proofs.find(tx, proofId));
    if (!proof) throw new AppError('NOT_FOUND', 'Payment proof not found');
    return proof.telegramFileId;
  }

  async paidWith(shopId: string, orderId: string): Promise<PaidWith> {
    const proof = await withShop(this.db, shopId, (tx) =>
      this.proofs.approvedForOrder(tx, orderId),
    );
    return {
      provider: proof?.provider ?? null,
      txRef: proof?.txRef ?? null,
      bankVerified: proof?.bankCheck === 'CONFIRMED',
    };
  }

  private async reviewItem(shopId: string, proof: PaymentProofRow): Promise<PaymentReviewItem> {
    const order = await this.orders.get(shopId, proof.orderId);
    const customer = await this.customers.get(shopId, order.customerId);
    const extraction = receiptFieldsSchema.safeParse(proof.extraction);
    return {
      proofId: proof.id,
      orderId: order.id,
      orderReference: orderReference(order.id),
      customerName: customer.name,
      orderTotal: order.total,
      receivedAt: proof.createdAt.toISOString(),
      extraction: extraction.success ? extraction.data : null,
      rules: proof.rules ?? {},
      bankCheck: proof.bankCheck,
      reasons: proof.reasons,
      payerHighRisk: await this.risk.isHighRisk({
        telegramUserId: customer.telegramUserId,
        phone: customer.phone,
      }),
    };
  }
}
