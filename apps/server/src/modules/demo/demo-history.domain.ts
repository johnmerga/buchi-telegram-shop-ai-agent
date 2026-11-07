import { Money, type DeliverySettings, type DeliveryType, type OrderStatus } from '@buchi/shared';
import { demoTelegramId } from '../../shared/demo-ids';
import { seededUuid } from '../../shared/seeded-random';
import { straightLineRoute } from '../delivery/distance.domain';
import { quoteDelivery } from '../delivery/fees.domain';
import type { Coordinates } from '../delivery/location.domain';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const ADDIS_ABABA_OFFSET_MS = 3 * 60 * MINUTE_MS;
/** Negotiated prices land on fifties, as people bargain in Addis. */
const PRICE_STEP = Money.of('50');

/**
 * A Telebirr reference that a demo order already used. The demo's "reused receipt" screenshot
 * prints it, so rule R6 rejects that screenshot as it would a real reused one.
 */
export const DEMO_REUSED_TELEBIRR_REF = 'DM0REUSED7';

/** Neighbourhoods that demo customers live in, at a well-known spot in each. */
export const ADDIS_AREAS = [
  { name: 'Bole', latitude: 8.9956, longitude: 38.7867, timeFactor: 1.35 },
  { name: 'CMC', latitude: 9.0216, longitude: 38.8468, timeFactor: 1.2 },
  { name: 'Piassa', latitude: 9.035, longitude: 38.752, timeFactor: 1.5 },
  { name: 'Megenagna', latitude: 9.02, longitude: 38.802, timeFactor: 1.45 },
  { name: 'Ayat', latitude: 9.031, longitude: 38.879, timeFactor: 1.15 },
  { name: 'Sarbet', latitude: 8.996, longitude: 38.734, timeFactor: 1.25 },
  { name: 'Gerji', latitude: 8.999, longitude: 38.815, timeFactor: 1.2 },
  { name: 'Kazanchis', latitude: 9.013, longitude: 38.767, timeFactor: 1.4 },
  { name: 'Mexico', latitude: 9.01, longitude: 38.745, timeFactor: 1.45 },
  { name: 'Summit', latitude: 9.001, longitude: 38.839, timeFactor: 1.1 },
  { name: '4 Kilo', latitude: 9.034, longitude: 38.763, timeFactor: 1.3 },
] as const;

const NAMES = [
  'Abebe Kebede',
  'Hanna Girma',
  'Dawit Alemu',
  'Meron Tadesse',
  'Yonas Bekele',
  'Liya Haile',
  'Bethlehem Mulugeta',
  'Samuel Getachew',
  'Tigist Assefa',
  'Natnael Worku',
  'Mahlet Desta',
  'Kidus Yohannes',
  'Rahel Abera',
  'Biniyam Tsegaye',
  'Eden Mekonnen',
  'Henok Fikru',
  'Saron Teshome',
  'Abel Negash',
  'Feven Ayele',
  'Kaleb Demissie',
  'Hiwot Lemma',
  'Nahom Berhanu',
  'Robel Gebre',
  'Mekdes Tilahun',
  'Yared Shiferaw',
  'Bezawit Hailu',
  'Eyob Tadele',
  'Ruth Alemayehu',
  'Amanuel Zewdu',
  'Tsion Wolde',
  'Mikiyas Bekele',
  'Martha Gizaw',
  'Elias Mamo',
  'Lidya Fekadu',
  'አበበ ታደሰ',
  'ሰላማዊት ካሳ',
  'ዳዊት ተስፋዬ',
  'መሰረት ደምሴ',
  'ዮሴፍ ኃይሉ',
  'ቤዛ ገብሩ',
];

/** A product that demo customers can have bought, with how often they buy it. */
export interface HistoryProduct {
  pricingMode: 'fixed' | 'negotiable';
  price: Money;
  lowestPrice: Money | null;
  variantIds: string[];
}

export interface HistoryInput {
  random: () => number;
  now: Date;
  /** The shop's location, or null when it has none and every order was a pickup. */
  origin: Coordinates | null;
  settings: DeliverySettings | null;
  /** Best-sellers first: the first three sell five times as often, and the last barely at all. */
  products: HistoryProduct[];
  /** The drivers who made the deliveries, as driver row IDs. */
  driverIds: string[];
  customers: number;
  orders: number;
  days: number;
}

export interface DemoCustomer {
  id: string;
  telegramUserId: number;
  name: string;
}

export interface TimelineStep {
  status: OrderStatus;
  actor: 'customer' | 'owner' | 'driver' | 'system';
  reason: string;
  at: Date;
}

export interface DemoPayment {
  provider: 'telebirr' | 'cbe_bank';
  txRef: string;
  decision: 'approve' | 'reject' | 'review';
  bankCheck: 'CONFIRMED' | 'UNAVAILABLE' | null;
  reasons: string[];
  ownerDecision: 'approved' | null;
  /** Set on the one rejected payment whose customer tapped **Report a problem**. */
  reportedAt: Date | null;
  at: Date;
}

export interface DemoTrip {
  id: string;
  driverId: string;
  payout: Money;
  routeMeters: number;
  routingSeconds: number;
  expectedSeconds: number;
  estimatedMinutes: number;
  actualMinutes: number;
  acceptedAt: Date;
  pickedUpAt: Date;
  deliveredAt: Date;
  metersFromPin: number;
  receipt: 'received' | 'assumed';
}

export interface DemoOrder {
  id: string;
  customerId: string;
  deliveryType: DeliveryType;
  variantId: string;
  unitPrice: Money;
  deliveryFee: Money;
  pin: Coordinates | null;
  timeline: [TimelineStep, ...TimelineStep[]];
  payment: DemoPayment | null;
  trip: DemoTrip | null;
}

export interface DemoHistory {
  customers: DemoCustomer[];
  orders: DemoOrder[];
}

type Outcome = 'delivered' | 'expired' | 'cancelled' | 'payment_rejected';

/**
 * Weeks of believable shop history: more orders at weekends, a few best-sellers, deliveries
 * across Addis neighbourhoods with their own traffic, Telebirr and CBE payments, and the usual
 * expired, cancelled, and rejected orders. The same generator state always gives the same history.
 */
export function planHistory(input: HistoryInput): DemoHistory {
  const { random } = input;
  const customers = Array.from({ length: input.customers }, (_, index) => ({
    id: seededUuid(random),
    telegramUserId: demoTelegramId(index + 1),
    name: NAMES[index % NAMES.length] ?? 'Demo customer',
  }));
  const homes = customers.map(() => pick(random, ADDIS_AREAS));
  const days = dayWeights(input.now, input.days);
  const orders = Array.from({ length: input.orders }, () => {
    const index = Math.floor(random() * customers.length);
    const customer = customers[index];
    const home = homes[index];
    if (!customer || !home) throw new Error('Unreachable: a customer index out of range');
    return planOrder(input, customer.id, home, startOf(random, days));
  });
  orders.sort((a, b) => a.timeline[0].at.getTime() - b.timeline[0].at.getTime());
  markReported(orders);
  useReusedReference(orders);
  return { customers, orders };
}

function planOrder(
  input: HistoryInput,
  customerId: string,
  home: (typeof ADDIS_AREAS)[number],
  createdAt: Date,
): DemoOrder {
  const { random } = input;
  const product = weightedProduct(random, input.products);
  const variantId = pick(random, product.variantIds);
  const unitPrice = priceOf(random, product);
  const delivery = deliveryOf(input, home);
  const outcome = outcomeOf(random);
  const id = seededUuid(random);
  const at = (minutes: number) => new Date(createdAt.getTime() + minutes * MINUTE_MS);
  const created: TimelineStep = {
    status: 'awaiting_payment',
    actor: 'customer',
    reason: 'Order created',
    at: createdAt,
  };
  const base = {
    id,
    customerId,
    deliveryType: delivery.type,
    variantId,
    unitPrice,
    deliveryFee: delivery.fee,
    pin: delivery.pin,
  };
  if (outcome === 'expired' || outcome === 'cancelled') {
    const closed: TimelineStep =
      outcome === 'expired'
        ? { status: 'expired', actor: 'system', reason: 'Payment time ran out', at: at(3) }
        : {
            status: 'cancelled',
            actor: 'customer',
            reason: 'Cancelled by the customer',
            at: at(2),
          };
    return { ...base, timeline: [created, closed], payment: null, trip: null };
  }
  const payment = paymentOf(random, outcome, at(2));
  const submitted: TimelineStep = {
    status: 'verifying',
    actor: 'customer',
    reason: 'Payment screenshot received',
    at: at(2),
  };
  if (outcome === 'payment_rejected') {
    const rejected: TimelineStep = {
      status: 'payment_rejected',
      actor: 'system',
      reason: 'Payment rejected',
      at: at(3),
    };
    return { ...base, timeline: [created, submitted, rejected], payment, trip: null };
  }
  const paid: TimelineStep = {
    status: 'paid',
    actor: payment.ownerDecision === null ? 'system' : 'owner',
    reason:
      payment.ownerDecision === null ? 'Payment checked with the bank' : 'Approved by the owner',
    at: at(payment.ownerDecision === null ? 3 : 12),
  };
  if (delivery.type === 'pickup' || delivery.route === null) {
    const pickedUpAfter = 60 + Math.floor(random() * 24 * 60);
    return {
      ...base,
      timeline: [
        created,
        submitted,
        paid,
        { status: 'ready_for_pickup', actor: 'owner', reason: 'Ready for pickup', at: at(20) },
        {
          status: 'delivered',
          actor: 'owner',
          reason: 'Picked up at the shop',
          at: at(20 + pickedUpAfter),
        },
      ],
      payment,
      trip: null,
    };
  }
  const trip = tripOf(input, delivery.route, home.timeFactor, paid.at);
  return {
    ...base,
    timeline: [
      created,
      submitted,
      paid,
      { status: 'dispatching', actor: 'system', reason: 'Offered to drivers', at: trip.acceptedAt },
      { status: 'assigned', actor: 'driver', reason: 'Accepted', at: trip.acceptedAt },
      { status: 'out_for_delivery', actor: 'driver', reason: 'Picked up', at: trip.pickedUpAt },
      { status: 'delivered', actor: 'driver', reason: 'Delivered', at: trip.deliveredAt },
    ],
    payment,
    trip,
  };
}

interface Delivery {
  type: DeliveryType;
  fee: Money;
  pin: Coordinates | null;
  route: { meters: number; seconds: number; payout: Money } | null;
}

/** The customer's pin near their neighbourhood, and the option they chose for that distance. */
function deliveryOf(input: HistoryInput, home: (typeof ADDIS_AREAS)[number]): Delivery {
  const { random, origin, settings } = input;
  const pickup: Delivery = { type: 'pickup', fee: Money.zero, pin: null, route: null };
  if (origin === null || settings === null || random() < 0.2) return pickup;
  const pin = {
    latitude: home.latitude + (random() - 0.5) * 0.008,
    longitude: home.longitude + (random() - 0.5) * 0.008,
  };
  const route = straightLineRoute(origin, pin);
  const quote = quoteDelivery(route, home.timeFactor, settings);
  const options = quote.options.filter((option) => option.type !== 'pickup');
  const option = options.length > 1 && random() < 0.3 ? options[1] : options[0];
  if (!option) return pickup;
  return {
    type: option.type,
    fee: option.fee,
    pin,
    route: { meters: route.meters, seconds: route.seconds, payout: option.payout },
  };
}

function tripOf(
  input: HistoryInput,
  route: NonNullable<Delivery['route']>,
  timeFactor: number,
  paidAt: Date,
): DemoTrip {
  const { random } = input;
  const expectedSeconds = Math.round(route.seconds * timeFactor);
  const estimatedMinutes = Math.max(5, Math.round(expectedSeconds / 60));
  const actualMinutes = Math.max(5, Math.round(estimatedMinutes * (0.8 + random() * 0.5)));
  const acceptedAt = new Date(paidAt.getTime() + (2 + random() * 8) * MINUTE_MS);
  const pickedUpAt = new Date(acceptedAt.getTime() + (8 + random() * 12) * MINUTE_MS);
  return {
    id: seededUuid(random),
    driverId: pick(random, input.driverIds),
    payout: route.payout,
    routeMeters: route.meters,
    routingSeconds: route.seconds,
    expectedSeconds,
    estimatedMinutes,
    actualMinutes,
    acceptedAt,
    pickedUpAt,
    deliveredAt: new Date(pickedUpAt.getTime() + actualMinutes * MINUTE_MS),
    metersFromPin: 15 + Math.floor(random() * 140),
    receipt: random() < 0.8 ? 'received' : 'assumed',
  };
}

/**
 * CBE's page confirms its payments, so Buchi approves them. Telebirr's page cannot be reached
 * from the server, so the owner approved those. Rejections are reused or misdirected receipts.
 */
function paymentOf(random: () => number, outcome: Outcome, at: Date): DemoPayment {
  const provider = random() < 0.55 ? 'telebirr' : 'cbe_bank';
  const txRef = provider === 'telebirr' ? telebirrReference(random) : cbeReference(random, at);
  const common = { provider, txRef, reportedAt: null, at } as const;
  if (outcome === 'payment_rejected') {
    return {
      ...common,
      decision: 'reject',
      bankCheck: null,
      reasons: [random() < 0.5 ? 'reused' : 'receiver'],
      ownerDecision: null,
    };
  }
  return provider === 'cbe_bank'
    ? { ...common, decision: 'approve', bankCheck: 'CONFIRMED', reasons: [], ownerDecision: null }
    : {
        ...common,
        decision: 'review',
        bankCheck: 'UNAVAILABLE',
        reasons: ['receiver_unconfirmed'],
        ownerDecision: 'approved',
      };
}

/** The newest rejected payment was reported, so it waits in the owner's review queue. */
function markReported(orders: DemoOrder[]): void {
  const rejected = orders.filter((order) => order.payment?.decision === 'reject');
  const last = rejected.at(-1)?.payment;
  if (last) last.reportedAt = new Date(last.at.getTime() + 5 * MINUTE_MS);
}

/** The oldest owner-approved Telebirr payment carries the reference that the demo reuses. */
function useReusedReference(orders: DemoOrder[]): void {
  const first = orders.find(
    (order) => order.payment?.provider === 'telebirr' && order.payment.ownerDecision !== null,
  );
  if (first?.payment) first.payment.txRef = DEMO_REUSED_TELEBIRR_REF;
}

function outcomeOf(random: () => number): Outcome {
  const roll = random();
  if (roll < 0.84) return 'delivered';
  if (roll < 0.91) return 'expired';
  if (roll < 0.96) return 'cancelled';
  return 'payment_rejected';
}

function priceOf(random: () => number, product: HistoryProduct): Money {
  if (product.lowestPrice === null) return product.price;
  const low = Number(product.lowestPrice.toString());
  const high = Number(product.price.toString());
  const agreed = Money.of(String(Math.round(low + random() * (high - low)))).roundUpTo(PRICE_STEP);
  return agreed.compare(product.price) > 0 ? product.price : agreed;
}

function weightedProduct(random: () => number, products: HistoryProduct[]): HistoryProduct {
  const weights = products.map((_, index) => {
    if (index < 3) return 5;
    return index === products.length - 1 && products.length > 3 ? 0.1 : 1;
  });
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  const index = weights.findIndex((weight) => (roll -= weight) < 0);
  const chosen = products[Math.max(index, 0)];
  if (!chosen) throw new Error('A history needs at least one product');
  return chosen;
}

/** The last `days` days, weekends twice as busy, as Addis Ababa midnights with their weights. */
function dayWeights(now: Date, days: number): { midnight: number; weight: number }[] {
  const today = now.getTime() + ADDIS_ABABA_OFFSET_MS;
  const midnight = today - (today % DAY_MS);
  return Array.from({ length: days }, (_, back) => {
    const local = midnight - (back + 1) * DAY_MS;
    const weekday = new Date(local).getUTCDay();
    const weight = weekday === 0 || weekday === 6 ? 2 : weekday === 5 ? 1.4 : 1;
    return { midnight: local - ADDIS_ABABA_OFFSET_MS, weight };
  });
}

/** A shop hour, 09:00 to 20:00 in Addis Ababa, on a day drawn by its weight. */
function startOf(random: () => number, days: { midnight: number; weight: number }[]): Date {
  let roll = random() * days.reduce((sum, day) => sum + day.weight, 0);
  const day = days.find((candidate) => (roll -= candidate.weight) < 0) ?? days[0];
  if (!day) throw new Error('A history needs at least one day');
  const hour = 9 + random() * 11;
  return new Date(day.midnight + hour * 60 * MINUTE_MS);
}

function telebirrReference(random: () => number): string {
  return `D${randomCode(random, 9)}`;
}

/** "FT", the year's last two digits, the day of the year it posted, and five characters. */
function cbeReference(random: () => number, at: Date): string {
  const local = new Date(at.getTime() + ADDIS_ABABA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const day = Math.floor((local.getTime() - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
  return `FT${String(year % 100).padStart(2, '0')}${String(day).padStart(3, '0')}${randomCode(random, 5)}`;
}

function randomCode(random: () => number, length: number): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => characters[Math.floor(random() * characters.length)]).join(
    '',
  );
}

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('Cannot pick from an empty list');
  return item;
}
