/** The evidence the sales agent weighs before it offers a price, each under the ID it cites. */
export const evidenceKinds = [
  'cart_items',
  'previous_orders',
  'stock_left',
  'asked_today',
  'days_in_stock',
] as const;
type EvidenceKind = (typeof evidenceKinds)[number];
export type PriceEvidence = Record<EvidenceKind, number>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Addis Ababa keeps UTC+3 all year. */
const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Shop records only, never personal details, as the design doc requires. */
export function priceEvidence(input: {
  unitsInCart: number;
  paidOrders: number;
  variants: { stock: number; reserved: number }[];
  askedToday: number;
  listedAt: Date;
  now: Date;
}): PriceEvidence {
  return {
    cart_items: input.unitsInCart,
    previous_orders: input.paidOrders,
    stock_left: input.variants.reduce((sum, v) => sum + Math.max(0, v.stock - v.reserved), 0),
    asked_today: input.askedToday,
    days_in_stock: Math.max(
      0,
      Math.floor((input.now.getTime() - input.listedAt.getTime()) / DAY_MS),
    ),
  };
}

/** Midnight in Addis Ababa at the start of the day that contains `now`. */
export function startOfAddisDay(now: Date): Date {
  const local = now.getTime() + ADDIS_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - ADDIS_OFFSET_MS);
}

const FORGET_REQUESTS = ['forget my details', 'delete my details', 'መረጃዬን እርሳ', 'መረጃዬን አጥፋ'];

/**
 * A request to forget the customer's details, recognized without the model so it works even when
 * Gemini is unavailable. Other wordings reach the agent, which has a tool for the same action.
 */
export function isForgetRequest(text: string): boolean {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return FORGET_REQUESTS.some((phrase) => normalized.includes(phrase));
}
