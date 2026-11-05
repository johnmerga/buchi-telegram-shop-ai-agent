import { Money } from '@buchi/shared';
import { AppError } from '../../shared/errors';
import type { CustomersService } from '../customers/customers.service';
import type { DeliveryService } from '../delivery/delivery.service';
import type { DeliveryQuote, PricedDeliveryType } from '../delivery/fees.domain';
import type { Coordinates } from '../delivery/location.domain';
import type { ShopsService } from '../shops/shops.service';
import { paymentInstructions } from './orders.domain';
import type { OrderRow } from './orders.repo';
import type { NewOrder, OrderDelivery, OrderService } from './orders.service';

/** The design doc's default payment deadline. */
const PAYMENT_WINDOW_MS = 3 * 60 * 60 * 1000;

export type PlaceOrderResult =
  | { status: 'needs_phone' }
  | { status: 'needs_location' }
  | { status: 'placed'; instructions: string };

type Customer = Awaited<ReturnType<CustomersService['identify']>>;

interface Buyer {
  telegramUserId: number;
  name: string;
}

/**
 * Turns a customer's chosen size into a reserved order with payment instructions. It asks for the
 * phone number first and, when the shop delivers, for the delivery pin and option.
 */
export class CheckoutService {
  constructor(
    private readonly customers: CustomersService,
    private readonly orders: OrderService,
    private readonly shops: ShopsService,
    private readonly delivery: Pick<DeliveryService, 'offersDelivery' | 'quote'>,
    private readonly now: () => Date,
  ) {}

  /** Checks the price before anything else, so nobody shares a phone number for an unpriced item. */
  async placeOrder(shopId: string, buyer: Buyer, variantId: string): Promise<PlaceOrderResult> {
    const customer = await this.customers.identify(shopId, buyer.telegramUserId, buyer.name);
    await this.customers.rememberChosenVariant(buyer.telegramUserId, variantId);
    if (!(await this.orders.unitPrice(shopId, customer.id, variantId))) {
      throw new AppError('CONFLICT', 'Agree the price with me first: tell me your offer');
    }
    return this.nextStep(shopId, customer, variantId);
  }

  /** The price the buyer pays for one unit, or `undefined` before a negotiable price is agreed. */
  async unitPrice(shopId: string, buyer: Buyer, variantId: string): Promise<Money | undefined> {
    const customer = await this.customers.identify(shopId, buyer.telegramUserId, buyer.name);
    return this.orders.unitPrice(shopId, customer.id, variantId);
  }

  /** Saves the shared phone number, then continues with the size the customer chose before. */
  async completeWithPhone(
    shopId: string,
    buyer: Buyer,
    phone: string,
    pendingVariantId: string | null,
  ): Promise<PlaceOrderResult | undefined> {
    const customer = await this.customers.identify(shopId, buyer.telegramUserId, buyer.name);
    await this.customers.setPhone(shopId, customer.id, phone);
    return pendingVariantId
      ? this.nextStep(shopId, { ...customer, phone }, pendingVariantId)
      : undefined;
  }

  /** Keeps the customer's pin for the order and quotes the delivery options to it. */
  async deliveryOptions(
    shopId: string,
    buyer: Buyer,
    pin: Coordinates,
  ): Promise<DeliveryQuote | undefined> {
    const customer = await this.customers.identify(shopId, buyer.telegramUserId, buyer.name);
    await this.customers.setDeliveryPin(shopId, customer.id, pin);
    return this.delivery.quote(shopId, pin);
  }

  /**
   * Places the order with the delivery option the customer tapped. The fee is quoted again from
   * the saved pin, because a button carries only the option's name.
   */
  async placeWithDelivery(
    shopId: string,
    buyer: Buyer,
    variantId: string,
    choice: PricedDeliveryType,
  ): Promise<PlaceOrderResult> {
    const customer = await this.customers.identify(shopId, buyer.telegramUserId, buyer.name);
    if (customer.phone === null) return { status: 'needs_phone' };
    const delivery = await this.chosenDelivery(shopId, customer, choice);
    return this.finish(shopId, customer, variantId, delivery);
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
      delivery: deliveryOf(expired),
    });
  }

  private async nextStep(
    shopId: string,
    customer: Customer,
    variantId: string,
  ): Promise<PlaceOrderResult> {
    if (customer.phone === null) return { status: 'needs_phone' };
    if (await this.delivery.offersDelivery(shopId)) return { status: 'needs_location' };
    return this.finish(shopId, customer, variantId, { type: 'pickup' });
  }

  private async chosenDelivery(
    shopId: string,
    customer: Customer,
    choice: PricedDeliveryType,
  ): Promise<OrderDelivery> {
    if (choice === 'pickup') return { type: 'pickup' };
    const { deliveryLatitude: latitude, deliveryLongitude: longitude } = customer;
    if (latitude === null || longitude === null) {
      throw new AppError('CONFLICT', 'Send your delivery location again');
    }
    const destination = { latitude, longitude };
    const quote = await this.delivery.quote(shopId, destination);
    const option = quote?.options.find((o) => o.type === choice);
    if (!option) throw new AppError('CONFLICT', 'This delivery option is no longer available');
    return { type: choice, fee: option.fee, destination };
  }

  private async finish(
    shopId: string,
    customer: Customer,
    variantId: string,
    delivery: OrderDelivery,
  ): Promise<PlaceOrderResult> {
    const instructions = await this.reserve(shopId, {
      customerId: customer.id,
      items: [{ variantId, quantity: 1 }],
      delivery,
    });
    await this.customers.rememberChosenVariant(customer.telegramUserId, null);
    if (delivery.type !== 'pickup') await this.customers.setDeliveryPin(shopId, customer.id, null);
    return { status: 'placed', instructions };
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
      deliveryType: created.deliveryType,
      itemsTotal: created.itemsTotal,
      deliveryFee: created.deliveryFee,
      total: created.total,
      deadline,
      accounts: paymentAccounts,
    });
  }
}

/** An order placed again keeps its delivery, at the fee the customer already saw. */
function deliveryOf(order: OrderRow): OrderDelivery {
  const { deliveryType: type, deliveryLatitude: latitude, deliveryLongitude: longitude } = order;
  if (type === 'pickup') return { type };
  // The orders_delivery_pin check guarantees a pin on every delivery order.
  if (latitude === null || longitude === null) throw new Error('A delivery order has no pin');
  return { type, fee: Money.of(order.deliveryFee), destination: { latitude, longitude } };
}
