import {
  formatBirr,
  Money,
  type DeliveryType,
  type MoneyString,
  type OrderStatus,
  type PaymentAccount,
  type PaymentProvider,
  type PricingMode,
} from '@buchi/shared';

export type OrderEvent =
  | 'quote_accepted'
  | 'payment_submitted'
  | 'payment_approved'
  | 'payment_unclear'
  | 'payment_rejected'
  | 'dispatched'
  | 'driver_assigned'
  | 'picked_up'
  | 'ready_for_pickup'
  | 'delivered'
  | 'expired'
  | 'cancelled';

/**
 * What a transition does to the stock that the order reserved:
 * `release` returns it to sale, and `commit` turns it into a sale.
 */
export type StockEffect = 'release' | 'commit' | 'none';

interface Transition {
  from: readonly OrderStatus[];
  to: OrderStatus;
  stock: StockEffect;
}

/** The order state machine from the design doc, as data. Anything not listed is forbidden. */
const transitions: Record<OrderEvent, Transition> = {
  quote_accepted: { from: ['quoting'], to: 'awaiting_payment', stock: 'none' },
  payment_submitted: { from: ['awaiting_payment'], to: 'verifying', stock: 'none' },
  payment_approved: { from: ['verifying', 'needs_review'], to: 'paid', stock: 'commit' },
  payment_unclear: { from: ['verifying'], to: 'needs_review', stock: 'none' },
  payment_rejected: { from: ['verifying', 'needs_review'], to: 'awaiting_payment', stock: 'none' },
  dispatched: { from: ['paid'], to: 'dispatching', stock: 'none' },
  // A far-area driver already holds the job when the customer pays, so paid can skip dispatching.
  driver_assigned: { from: ['paid', 'dispatching'], to: 'assigned', stock: 'none' },
  picked_up: { from: ['assigned'], to: 'out_for_delivery', stock: 'none' },
  ready_for_pickup: { from: ['paid'], to: 'ready_for_pickup', stock: 'none' },
  delivered: { from: ['out_for_delivery', 'ready_for_pickup'], to: 'delivered', stock: 'none' },
  expired: { from: ['quoting', 'awaiting_payment'], to: 'expired', stock: 'release' },
  cancelled: { from: ['quoting', 'awaiting_payment'], to: 'cancelled', stock: 'release' },
};

export type TransitionResult =
  { allowed: true; to: OrderStatus; stock: StockEffect } | { allowed: false };

export function nextState(current: OrderStatus, event: OrderEvent): TransitionResult {
  const transition = transitions[event];
  return transition.from.includes(current)
    ? { allowed: true, to: transition.to, stock: transition.stock }
    : { allowed: false };
}

interface PricedProduct {
  pricingMode: PricingMode;
  /** The shown price of a fixed-price product, or the asking price of a negotiable one. */
  price: MoneyString;
  lowestPrice: MoneyString | null;
}

type UnitPrice = { status: 'priced'; price: Money } | { status: 'needs_agreement' };

/**
 * The price one unit sells at. A fixed-price product always sells at its own price, whatever was
 * agreed. A negotiable product sells only at an agreed price that is still within the owner's
 * range, so a price agreed before the owner changed the range is negotiated again.
 */
export function unitPriceOf(product: PricedProduct, agreed: Money | undefined): UnitPrice {
  if (product.pricingMode === 'fixed') return { status: 'priced', price: Money.of(product.price) };
  if (product.lowestPrice === null) throw new Error('A negotiable product has no lowest price');
  const withinRange =
    agreed !== undefined &&
    agreed.compare(Money.of(product.lowestPrice)) >= 0 &&
    agreed.compare(Money.of(product.price)) <= 0;
  return withinRange ? { status: 'priced', price: agreed } : { status: 'needs_agreement' };
}

/** Statuses of an order that the customer paid for, which count as buying before. */
export const paidStatuses: readonly OrderStatus[] = [
  'paid',
  'dispatching',
  'assigned',
  'out_for_delivery',
  'ready_for_pickup',
  'delivered',
];

/** A short order number that customers can read out, such as "#3F2A9C". */
export function orderReference(orderId: string): string {
  return `#${orderId.slice(0, 6).toUpperCase()}`;
}

const providerNames: Record<PaymentProvider, string> = {
  telebirr: 'Telebirr',
  cbe_birr: 'CBE Birr',
  cbe_bank: 'CBE (Commercial Bank of Ethiopia)',
};

const addisTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Addis_Ababa',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const deliveryNames: Record<Exclude<DeliveryType, 'pickup'>, string> = {
  free: 'ነፃ ማድረሻ / Free delivery',
  express: 'ፈጣን ማድረሻ / Express delivery',
  saver: 'ቁጠባ ማድረሻ / Saver delivery',
  far: 'ማድረሻ / Delivery',
};

/** Pickup shows only the total. A delivery shows what the items and the delivery each cost. */
function amountLines(input: {
  deliveryType: DeliveryType;
  itemsTotal: MoneyString;
  deliveryFee: MoneyString;
  total: MoneyString;
}): string {
  const total = `ጠቅላላ / Total: ${formatBirr(input.total)}`;
  if (input.deliveryType === 'pickup') return `${total}\nPickup at the shop.`;
  return [
    `ዕቃዎች / Items: ${formatBirr(input.itemsTotal)}`,
    `${deliveryNames[input.deliveryType]}: ${formatBirr(input.deliveryFee)}`,
    total,
  ].join('\n');
}

/**
 * Payment instructions come from this template, never from the model, so account numbers and
 * amounts are always exactly what the shop configured.
 */
export function paymentInstructions(input: {
  orderId: string;
  deliveryType: DeliveryType;
  itemsTotal: MoneyString;
  deliveryFee: MoneyString;
  total: MoneyString;
  deadline: Date;
  accounts: PaymentAccount[];
}): string {
  const accounts = input.accounts.map(
    (a) => `• ${providerNames[a.provider]}: ${a.accountNumber} (${a.accountName})`,
  );
  return [
    `✅ ትዕዛዝ ${orderReference(input.orderId)} ተይዞልዎታል / Order ${orderReference(input.orderId)} is reserved for you.`,
    amountLines(input),
    ['ከእነዚህ በአንዱ ይክፈሉ / Pay to one of these accounts:', ...accounts].join('\n'),
    `Pay before ${addisTime.format(input.deadline)} (Addis Ababa time), then send the payment screenshot here.`,
  ].join('\n\n');
}
