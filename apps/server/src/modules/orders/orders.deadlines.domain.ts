export const orderTimerKinds = {
  expire: 'order.expire',
  quoteExpire: 'order.quote_expire',
  holdExpire: 'stock_hold.expire',
} as const;

/**
 * The owner's rule: an order's stock is held for its customer for three minutes after the payment
 * instructions, so an unpaid order never keeps an item from other buyers for long.
 */
export const PAYMENT_HOLD_MS = 3 * 60_000;

/** The design doc's rule: a restocked unit waits 30 minutes for each waitlisted customer. */
export const WAITLIST_HOLD_MS = 30 * 60_000;

/** The design doc's rule: a far-area quote holds the stock for 20 minutes. */
export const QUOTE_HOLD_MS = 20 * 60_000;
