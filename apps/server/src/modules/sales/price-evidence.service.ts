import type { CustomersService } from '../customers/customers.service';
import type { OrderService } from '../orders/orders.service';
import type { NegotiationService } from './negotiation.service';
import { priceEvidence, startOfAddisDay, type PriceEvidence } from './sales.domain';

interface Product {
  id: string;
  createdAt: Date;
  variants: { id: string; stock: number; reserved: number }[];
}

/** Gathers the shop records that the sales agent weighs before it offers a price. */
export class PriceEvidenceService {
  constructor(
    private readonly customers: Pick<CustomersService, 'sessionOf'>,
    private readonly orders: Pick<OrderService, 'paidOrderCount'>,
    private readonly negotiations: Pick<NegotiationService, 'customersAskedSince'>,
    private readonly now: () => Date,
  ) {}

  async evidence(
    shopId: string,
    customer: { id: string; telegramUserId: number },
    product: Product,
  ): Promise<PriceEvidence> {
    const now = this.now();
    const [session, paidOrders, askedToday] = await Promise.all([
      this.customers.sessionOf(customer.telegramUserId),
      this.orders.paidOrderCount(shopId, customer.id),
      this.negotiations.customersAskedSince(shopId, product.id, startOfAddisDay(now)),
    ]);
    const inCart = product.variants.some((variant) => variant.id === session?.pendingVariantId);
    return priceEvidence({
      unitsInCart: inCart ? 1 : 0,
      paidOrders,
      variants: product.variants,
      askedToday,
      listedAt: product.createdAt,
      now,
    });
  }
}
