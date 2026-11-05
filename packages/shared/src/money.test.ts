import { describe, expect, it } from 'vitest';
import { Money, moneySchema } from './money';

describe('moneySchema', () => {
  it.each(['0', '100', '100.00', '12.23', '12.5'])('accepts %s', (value) => {
    expect(moneySchema.safeParse(value).success).toBe(true);
  });

  it.each(['12.234', '-1.00', '1,000.00', '12.', '.50', 'abc', ''])('rejects %s', (value) => {
    expect(moneySchema.safeParse(value).success).toBe(false);
  });
});

describe('Money', () => {
  it('always prints two decimals', () => {
    expect(Money.of('100').toString()).toBe('100.00');
    expect(Money.of('12.5').toString()).toBe('12.50');
    expect(Money.of('0.05').toString()).toBe('0.05');
  });

  it('adds exactly where floating-point numbers do not', () => {
    expect(Money.of('0.1').add(Money.of('0.2')).toString()).toBe('0.30');
  });

  it('multiplies by a whole quantity', () => {
    expect(Money.of('3499.99').times(3).toString()).toBe('10499.97');
    expect(() => Money.of('1').times(1.5)).toThrow(RangeError);
  });

  it('compares amounts', () => {
    expect(Money.of('3000').compare(Money.of('3500.00'))).toBe(-1);
    expect(Money.of('3500').compare(Money.of('3500.00'))).toBe(0);
    expect(Money.of('3500.01').compare(Money.of('3500'))).toBe(1);
  });
});
