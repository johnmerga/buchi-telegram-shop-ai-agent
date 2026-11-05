import type { CustomersService } from '../customers/customers.service';
import type { ShopsService } from '../shops/shops.service';
import { paymentInstructions } from './orders.domain';
import type { OrderService } from './orders.service';

/** The design doc's default payment deadline. */
const PAYMENT_WINDOW_MS = 3 * 60 * 60 * 1000;

export type PlaceOrderResult =
  { status: 'needs_phone' } | { status: 'placed'; instructions: string };

/** Turns a customer's chosen size into a reserved order with payment instructions. */
export class CheckoutService {
  constructor(
    private readonly customers: CustomersService,
    private readonly orders: OrderService,
    private readonly shops: ShopsService,
    private readonly now: () => Date,
  ) {}

  async placeOrder(
    shopId: string,
    buyer: { telegramUserId: number; name: string },
    variantId: string,
  ): Promise<PlaceOrderResult> {
    const customer = await this.customers.identify(shopId, buyer.telegramUserId, buyer.name);
    if (customer.phone === null) {
      await this.customers.rememberChosenVariant(buyer.telegramUserId, variantId);
      return { status: 'needs_phone' };
    }

    const deadline = new Date(this.now().getTime() + PAYMENT_WINDOW_MS);
    const order = await this.orders.create(
      shopId,
      {
        customerId: customer.id,
        items: [{ variantId, quantity: 1 }],
        deliveryType: 'pickup',
        paymentDeadline: deadline,
      },
      'customer',
    );
    await this.customers.rememberChosenVariant(buyer.telegramUserId, null);
    const { paymentAccounts } = await this.shops.get(shopId);
    return {
      status: 'placed',
      instructions: paymentInstructions({
        orderId: order.id,
        total: order.total,
        deadline,
        accounts: paymentAccounts,
      }),
    };
  }

  /** Saves the shared phone number, then places the order the customer chose before sharing it. */
  async completeWithPhone(
    shopId: string,
    buyer: { telegramUserId: number; name: string },
    phone: string,
    pendingVariantId: string | null,
  ): Promise<PlaceOrderResult | undefined> {
    const customer = await this.customers.identify(shopId, buyer.telegramUserId, buyer.name);
    await this.customers.setPhone(shopId, customer.id, phone);
    return pendingVariantId ? this.placeOrder(shopId, buyer, pendingVariantId) : undefined;
  }
}
