import type { CatalogService } from '../../../modules/catalog/catalog.service';
import type { CustomerMemoryService } from '../../../modules/customers/customer-memory.service';
import type { CustomersService } from '../../../modules/customers/customers.service';
import type { OrderService } from '../../../modules/orders/orders.service';
import { salesContext, type SalesContextInput } from './conversation.domain';

interface Customer {
  id: string;
  telegramUserId: number;
}

/** Reads what the sales agent should know before each turn: the product, the cart, and facts. */
export class SalesContext {
  constructor(
    private readonly catalog: Pick<CatalogService, 'activeProducts' | 'variantForSale'>,
    private readonly customers: Pick<CustomersService, 'sessionOf'>,
    private readonly orders: Pick<OrderService, 'unitPrice'>,
    private readonly memory: Pick<CustomerMemoryService, 'facts'>,
  ) {}

  async build(shopId: string, customer: Customer): Promise<ReturnType<typeof salesContext>> {
    const session = await this.customers.sessionOf(customer.telegramUserId);
    const [opened, cart, facts] = await Promise.all([
      this.opened(shopId, session?.productId ?? null),
      this.cart(shopId, customer, session?.pendingVariantId ?? null),
      this.memory.facts(shopId, customer.id),
    ]);
    return salesContext({ opened, cart, facts });
  }

  private async opened(
    shopId: string,
    productId: string | null,
  ): Promise<SalesContextInput['opened']> {
    if (productId === null) return undefined;
    const [product] = await this.catalog.activeProducts(shopId, [productId]);
    return (
      product && {
        productId: product.id,
        title: product.title,
        pricingMode: product.pricingMode,
        price: product.price,
      }
    );
  }

  private async cart(
    shopId: string,
    customer: Customer,
    variantId: string | null,
  ): Promise<SalesContextInput['cart']> {
    if (variantId === null) return undefined;
    const forSale = await this.catalog.variantForSale(shopId, variantId);
    if (!forSale) return undefined;
    const price = await this.orders.unitPrice(shopId, customer.id, variantId);
    return {
      variantId,
      title: forSale.product.title,
      size: forSale.variant.size,
      price: price?.toString(),
    };
  }
}
