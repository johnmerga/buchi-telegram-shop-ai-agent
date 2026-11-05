import { AppError } from '../../shared/errors';
import type { CustomersService } from '../customers/customers.service';
import type { ShopsService } from '../shops/shops.service';
import { paymentInstructions } from './orders.domain';
import type { NewOrder, OrderService } from './orders.service';

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

    const instructions = await this.reserve(shopId, {
      customerId: customer.id,
      items: [{ variantId, quantity: 1 }],
      deliveryType: 'pickup',
    });
    await this.customers.rememberChosenVariant(buyer.telegramUserId, null);
    return { status: 'placed', instructions };
  }

  /** Places an expired order again with the same items, only for the customer who placed it. */
  async reorder(telegramUserId: number, orderId: string): Promise<string> {
    const expired = await this.orders.getForCustomer(telegramUserId, orderId);
    if (expired.status !== 'expired') {
      throw new AppError('CONFLICT', 'Only an expired order can be ordered again');
    }
    return this.reserve(expired.shopId, {
      customerId: expired.customerId,
      items: expired.items.map(({ variantId, quantity }) => ({ variantId, quantity })),
      deliveryType: expired.deliveryType,
    });
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

  /** Creates the order with the standard payment window and returns its payment instructions. */
  private async reserve(shopId: string, order: Omit<NewOrder, 'paymentDeadline'>): Promise<string> {
    const deadline = new Date(this.now().getTime() + PAYMENT_WINDOW_MS);
    const created = await this.orders.create(
      shopId,
      { ...order, paymentDeadline: deadline },
      'customer',
    );
    const { paymentAccounts } = await this.shops.get(shopId);
    return paymentInstructions({
      orderId: created.id,
      total: created.total,
      deadline,
      accounts: paymentAccounts,
    });
  }
}
