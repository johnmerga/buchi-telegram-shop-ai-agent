import { orderStatusSchema, type OrderStatus } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { nextState, orderReference, paymentInstructions, type OrderEvent } from './orders.domain';

/** Every allowed move, written out independently of the table in the code under test. */
const allowed: [OrderStatus, OrderEvent, OrderStatus, string][] = [
  ['quoting', 'quote_accepted', 'awaiting_payment', 'none'],
  ['awaiting_payment', 'payment_submitted', 'verifying', 'none'],
  ['verifying', 'payment_approved', 'paid', 'commit'],
  ['needs_review', 'payment_approved', 'paid', 'commit'],
  ['verifying', 'payment_unclear', 'needs_review', 'none'],
  ['verifying', 'payment_rejected', 'awaiting_payment', 'none'],
  ['needs_review', 'payment_rejected', 'awaiting_payment', 'none'],
  ['paid', 'dispatched', 'dispatching', 'none'],
  ['paid', 'driver_assigned', 'assigned', 'none'],
  ['dispatching', 'driver_assigned', 'assigned', 'none'],
  ['assigned', 'picked_up', 'out_for_delivery', 'none'],
  ['paid', 'ready_for_pickup', 'ready_for_pickup', 'none'],
  ['out_for_delivery', 'delivered', 'delivered', 'none'],
  ['ready_for_pickup', 'delivered', 'delivered', 'none'],
  ['quoting', 'expired', 'expired', 'release'],
  ['awaiting_payment', 'expired', 'expired', 'release'],
  ['quoting', 'cancelled', 'cancelled', 'release'],
  ['awaiting_payment', 'cancelled', 'cancelled', 'release'],
];

const events = [...new Set(allowed.map(([, event]) => event))];

describe('nextState', () => {
  it.each(allowed)('%s + %s → %s (stock: %s)', (from, event, to, stock) => {
    expect(nextState(from, event)).toEqual({ allowed: true, to, stock });
  });

  it('forbids every move that the design does not list', () => {
    for (const from of orderStatusSchema.options) {
      for (const event of events) {
        const isListed = allowed.some(([f, e]) => f === from && e === event);
        expect(nextState(from, event).allowed, `${from} + ${event}`).toBe(isListed);
      }
    }
  });

  it('never leaves a final state', () => {
    for (const from of ['delivered', 'expired', 'cancelled'] as const) {
      for (const event of events) {
        expect(nextState(from, event).allowed).toBe(false);
      }
    }
  });
});

describe('orderReference', () => {
  it('uses the first six characters of the order ID in uppercase', () => {
    expect(orderReference('3f2a9c1e-0000-4000-8000-000000000000')).toBe('#3F2A9C');
  });
});

describe('paymentInstructions', () => {
  const text = paymentInstructions({
    orderId: '3f2a9c1e-0000-4000-8000-000000000000',
    total: '4500',
    deadline: new Date('2026-11-05T15:30:00Z'),
    accounts: [
      { provider: 'telebirr', accountName: 'Selam Tesfaye', accountNumber: '0911234567' },
      { provider: 'cbe_bank', accountName: 'Selam Tesfaye', accountNumber: '1000123456789' },
    ],
  });

  it('lists the exact total and every account', () => {
    expect(text).toContain('#3F2A9C');
    expect(text).toContain('4,500.00 ብር');
    expect(text).toContain('Telebirr: 0911234567 (Selam Tesfaye)');
    expect(text).toContain('CBE (Commercial Bank of Ethiopia): 1000123456789');
  });

  it('shows the deadline in Addis Ababa time', () => {
    expect(text).toContain('5 Nov, 18:30');
  });
});
