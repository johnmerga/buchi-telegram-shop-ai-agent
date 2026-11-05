import { describe, expect, it } from 'vitest';
import { isForgetRequest, priceEvidence, startOfAddisDay } from './sales.domain';

describe('priceEvidence', () => {
  const base = {
    unitsInCart: 1,
    paidOrders: 2,
    variants: [
      { stock: 3, reserved: 1 },
      { stock: 1, reserved: 1 },
    ],
    askedToday: 4,
    listedAt: new Date('2026-09-01T10:00:00Z'),
    now: new Date('2026-11-05T09:00:00Z'),
  };

  it('counts unreserved stock and whole days since the product was listed', () => {
    expect(priceEvidence(base)).toEqual({
      cart_items: 1,
      previous_orders: 2,
      stock_left: 2,
      asked_today: 4,
      days_in_stock: 64,
    });
  });

  it('never reports negative stock or days', () => {
    const evidence = priceEvidence({
      ...base,
      variants: [{ stock: 0, reserved: 0 }],
      listedAt: new Date('2026-11-06T00:00:00Z'),
    });
    expect(evidence).toMatchObject({ stock_left: 0, days_in_stock: 0 });
  });
});

describe('startOfAddisDay', () => {
  it('is 21:00 UTC of the day before', () => {
    expect(startOfAddisDay(new Date('2026-11-05T09:00:00Z'))).toEqual(
      new Date('2026-11-04T21:00:00Z'),
    );
  });

  it('moves to the next day at midnight in Addis Ababa', () => {
    expect(startOfAddisDay(new Date('2026-11-05T21:30:00Z'))).toEqual(
      new Date('2026-11-05T21:00:00Z'),
    );
  });
});

describe('isForgetRequest', () => {
  it.each(['Forget my details', 'please   FORGET ME', 'እባክህ መረጃዬን እርሳ'])(
    'recognizes "%s"',
    (text) => {
      expect(isForgetRequest(text)).toBe(true);
    },
  );

  it('ignores other messages', () => {
    expect(isForgetRequest('Do you have size 42?')).toBe(false);
  });
});
