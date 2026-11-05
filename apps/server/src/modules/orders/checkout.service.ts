import { Money } from '@buchi/shared';
import { AppError } from '../../shared/errors';
import type { CustomersService } from '../customers/customers.service';
import type { DeliveryService } from '../delivery/delivery.service';
import type { DeliveryQuote, PricedDeliveryType } from '../delivery/fees.domain';
import type { Coordinates } from '../delivery/location.domain';
import type { ShopsService } from '../shops/shops.service';
import { PAYMENT_WINDOW_MS, QUOTE_HOLD_MS } from './orders.deadlines.domain';
import { paymentInstructions } from './orders.domain';
import type { OrderRow } from './orders.repo';
import type { NewOrder, OrderDelivery, OrderService } from './orders.service';

export type PlaceOrderResult =
  | { status: 'needs_phone' }
  | { status: 'needs_location' }
  | { status: 'placed'; orderId: string; instructions: string };

/** The stock is held while drivers price a far-area delivery. */
export type FarQuoteRequest =
  { status: 'needs_phone' } | { status: 'quoting'; shopId: string; orderId: string };

export type CheckoutStep = PlaceOrderResult | FarQuoteRequest;

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

  /**
   * Holds the item for 20 minutes while the drivers price a delivery to the far area. The pin and
   * the chosen size stay with the customer until they accept a price.
   */
  async requestFarQuote(shopId: string, buyer: Buyer, variantId: string): Promise<FarQuoteRequest> {
    const customer = await this.customers.identify(shopId, buyer.telegramUserId, buyer.name);
    if (customer.phone === null) return { status: 'needs_phone' };
    const destination = savedPin(customer);
    if ((await this.delivery.quote(shopId, destination))?.area !== 'far') {
      throw new AppError('CONFLICT', 'This location is not in the far delivery area');
    }
    const holdUntil = new Date(this.now().getTime() + QUOTE_HOLD_MS);
    const order = await this.orders.createQuoting(
      shopId,
      { customerId: customer.id, items: [{ variantId, quantity: 1 }], destination },
      holdUntil,
      'customer',
    );
    return { status: 'quoting', shopId, orderId: order.id };
  }

  /**
   * Sets the delivery fee that a driver holds and starts the payment deadline. Returns the payment
   * instructions. The pin now lives on the order, so the customer's copy is cleared.
   */
  async acceptFarQuote(shopId: string, orderId: string, fee: Money): Promise<string> {
    const acceptedAt = this.now();
    const deadline = new Date(acceptedAt.getTime() + PAYMENT_WINDOW_MS);
    const order = await this.orders.acceptQuote(shopId, orderId, {
      fee,
      acceptedAt,
      paymentDeadline: deadline,
    });
    const customer = await this.customers.get(shopId, order.customerId);
    await this.customers.rememberChosenVariant(customer.telegramUserId, null);
    await this.customers.setDeliveryPin(shopId, customer.id, null);
    return this.instructions(order, deadline);
  }

  /** Places an expired order again with the same items, only for the customer who placed it. */
  async reorder(telegramUserId: number, orderId: string): Promise<string> {
    const expired = await this.orders.getForCustomer(telegramUserId, orderId);
    if (expired.status !== 'expired') {
      throw new AppError('CONFLICT', 'Only an expired order can be ordered again');
    }
    const placed = await this.reserve(expired.shopId, {
      customerId: expired.customerId,
      items: expired.items.map(({ variantId, quantity }) => ({ variantId, quantity })),
      delivery: deliveryOf(expired),
    });
    return placed.instructions;
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
    const destination = savedPin(customer);
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
    const placed = await this.reserve(shopId, {
      customerId: customer.id,
      items: [{ variantId, quantity: 1 }],
      delivery,
    });
    await this.customers.rememberChosenVariant(customer.telegramUserId, null);
    if (delivery.type !== 'pickup') await this.customers.setDeliveryPin(shopId, customer.id, null);
    return { status: 'placed', ...placed };
  }

  /** Creates the order with the standard payment window and returns its payment instructions. */
  private async reserve(
    shopId: string,
    order: Omit<NewOrder, 'paymentDeadline'>,
  ): Promise<{ orderId: string; instructions: string }> {
    const deadline = new Date(this.now().getTime() + PAYMENT_WINDOW_MS);
    const created = await this.orders.create(
      shopId,
      { ...order, paymentDeadline: deadline },
      'customer',
    );
    return { orderId: created.id, instructions: await this.instructions(created, deadline) };
  }

  private async instructions(order: OrderRow, deadline: Date): Promise<string> {
    const { paymentAccounts } = await this.shops.get(order.shopId);
    return paymentInstructions({
      orderId: order.id,
      deliveryType: order.deliveryType,
      itemsTotal: order.itemsTotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      deadline,
      accounts: paymentAccounts,
    });
  }
}

function savedPin(customer: Customer): Coordinates {
  const { deliveryLatitude: latitude, deliveryLongitude: longitude } = customer;
  if (latitude === null || longitude === null) {
    throw new AppError('CONFLICT', 'Send your delivery location again');
  }
  return { latitude, longitude };
}

/** An order placed again keeps its delivery, at the fee the customer already saw. */
function deliveryOf(order: OrderRow): OrderDelivery {
  const { deliveryType: type, deliveryLatitude: latitude, deliveryLongitude: longitude } = order;
  if (type === 'pickup') return { type };
  // The orders_delivery_pin check guarantees a pin on every delivery order.
  if (latitude === null || longitude === null) throw new Error('A delivery order has no pin');
  return { type, fee: Money.of(order.deliveryFee), destination: { latitude, longitude } };
}
