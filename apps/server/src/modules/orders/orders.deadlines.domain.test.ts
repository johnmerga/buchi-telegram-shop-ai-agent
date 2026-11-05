import { describe, expect, it } from 'vitest';
import { minutesLeft, paymentTimers } from './orders.deadlines.domain';

const createdAt = new Date('2026-11-05T09:00:00Z');
const at = (iso: string) => new Date(iso);

describe('paymentTimers', () => {
  it('reminds one hour after the order and expires it at the deadline', () => {
    expect(paymentTimers(createdAt, at('2026-11-05T12:00:00Z'))).toEqual([
      { kind: 'order.payment_reminder', dueAt: at('2026-11-05T10:00:00Z') },
      { kind: 'order.expire', dueAt: at('2026-11-05T12:00:00Z') },
    ]);
  });

  it('skips the reminder when the deadline comes first', () => {
    expect(paymentTimers(createdAt, at('2026-11-05T10:00:00Z'))).toEqual([
      { kind: 'order.expire', dueAt: at('2026-11-05T10:00:00Z') },
    ]);
  });
});

describe('minutesLeft', () => {
  it('counts whole minutes before the deadline', () => {
    expect(minutesLeft(at('2026-11-05T12:00:00Z'), at('2026-11-05T10:29:30Z'))).toBe(90);
  });

  it('never goes below zero after the deadline', () => {
    expect(minutesLeft(at('2026-11-05T12:00:00Z'), at('2026-11-05T12:05:00Z'))).toBe(0);
  });
});
