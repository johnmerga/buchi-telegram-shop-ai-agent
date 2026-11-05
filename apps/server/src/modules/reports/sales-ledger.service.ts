import type { DomainEvents } from '../../shared/events';
import { orderReference } from '../orders/orders.domain';
import type { OrderService } from '../orders/orders.service';
import type { PaymentRecords } from '../payments/payment-records.service';
import { saleRow } from './ledger.domain';
import type { LedgerService } from './ledger.service';

/** A paid order's row in the ledger, written when its payment is approved by Buchi or the owner. */
export class SalesLedger {
  constructor(
    private readonly orders: Pick<OrderService, 'get' | 'summary'>,
    private readonly payments: Pick<PaymentRecords, 'paidWith'>,
    private readonly ledger: Pick<LedgerService, 'enqueue'>,
    private readonly now: () => Date,
  ) {}

  /** A rescheduled delivery also returns an order to `paid`, which is not a new sale. */
  async orderTransitioned(event: DomainEvents['order.transitioned']): Promise<void> {
    const { shopId, orderId, from, to } = event;
    if (to !== 'paid' || (from !== 'verifying' && from !== 'needs_review')) return;
    const [order, summary, payment] = await Promise.all([
      this.orders.get(shopId, orderId),
      this.orders.summary(shopId, orderId),
      this.payments.paidWith(shopId, orderId),
    ]);
    await this.ledger.enqueue(
      shopId,
      saleRow({
        orderId,
        orderReference: orderReference(orderId),
        paidAt: this.now(),
        lines: summary.lines,
        deliveryFee: order.deliveryFee,
        total: order.total,
        payment,
      }),
    );
  }
}
