import {
  receiptFieldsSchema,
  type PaymentDecisionItem,
  type PaymentProvider,
  type PaymentReviewItem,
} from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { CustomersService } from '../customers/customers.service';
import { orderReference } from '../orders/orders.domain';
import type { OrderService } from '../orders/orders.service';
import { settledOutcome } from './payment-history.domain';
import type { PaymentProofRow, PaymentProofsRepo, SettledProofRow } from './payment-proofs.repo';
import type { RiskService } from './risk.service';

/** How an order was paid, for the sales ledger. Empty when the owner approved an unread receipt. */
interface PaidWith {
  provider: PaymentProvider | null;
  txRef: string | null;
  bankVerified: boolean;
}

/** How many settled payments the owner's history shows. */
const RECENT_DECISIONS = 20;

/**
 * Read-only views of payment proofs: the owner's review queue, recent decisions, screenshots, and
 * the ledger.
 */
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

  /** The newest payments that Buchi or the owner settled, newest first. */
  async recentDecisions(shopId: string): Promise<PaymentDecisionItem[]> {
    const rows = await withShop(this.db, shopId, (tx) =>
      this.proofs.recentlySettled(tx, RECENT_DECISIONS),
    );
    return rows.flatMap(decisionItem);
  }

  /** The Telegram file ID of a proof's screenshot. The image itself is never stored. */
  async screenshotFileId(shopId: string, proofId: string): Promise<string> {
    const proof = await withShop(this.db, shopId, (tx) => this.proofs.find(tx, proofId));
    if (!proof) throw new AppError('NOT_FOUND', 'Payment proof not found');
    if (proof.telegramFileId === null) {
      throw new AppError('NOT_FOUND', 'This payment was proven by a receipt link');
    }
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
      customerReported: proof.reportedAt !== null,
    };
  }
}

/** The query returns only settled proofs, so one without an outcome is skipped, not guessed. */
function decisionItem({ proof, orderId, customerName }: SettledProofRow): PaymentDecisionItem[] {
  const settled = settledOutcome(proof);
  if (!settled) return [];
  return [
    {
      proofId: proof.id,
      orderReference: orderReference(orderId),
      customerName,
      amount: proof.amount,
      provider: proof.provider,
      ...settled,
      receivedAt: proof.createdAt.toISOString(),
      bankCheck: proof.bankCheck,
      reasons: proof.reasons,
    },
  ];
}
