import type { OrderStatus } from '@buchi/shared';

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
