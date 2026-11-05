import { describe, expect, it } from 'vitest';
import { formatBirr, Money, moneySchema } from './money';

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

  it('subtracts and refuses to go below zero', () => {
    expect(Money.of('1000').subtract(Money.of('799.99')).toString()).toBe('200.01');
    expect(Money.of('5').subtract(Money.of('5')).toString()).toBe('0.00');
    expect(() => Money.of('5').subtract(Money.of('5.01'))).toThrow(RangeError);
  });

  it('divides by a whole number and rounds up to the cent', () => {
    expect(Money.of('200').divideRoundingUp(4).toString()).toBe('50.00');
    expect(Money.of('0.01').divideRoundingUp(4).toString()).toBe('0.01');
    expect(Money.of('100.01').divideRoundingUp(4).toString()).toBe('25.01');
    expect(Money.zero.divideRoundingUp(4).toString()).toBe('0.00');
    expect(() => Money.of('1').divideRoundingUp(0)).toThrow(RangeError);
    expect(() => Money.of('1').divideRoundingUp(1.5)).toThrow(RangeError);
  });

  it('rounds up to a multiple of a step', () => {
    const fifty = Money.of('50');
    expect(Money.of('850').roundUpTo(fifty).toString()).toBe('850.00');
    expect(Money.of('850.01').roundUpTo(fifty).toString()).toBe('900.00');
    expect(Money.of('0').roundUpTo(fifty).toString()).toBe('0.00');
    expect(() => Money.of('1').roundUpTo(Money.zero)).toThrow(RangeError);
  });

  it('compares amounts', () => {
    expect(Money.of('3000').compare(Money.of('3500.00'))).toBe(-1);
    expect(Money.of('3500').compare(Money.of('3500.00'))).toBe(0);
    expect(Money.of('3500.01').compare(Money.of('3500'))).toBe(1);
  });
});

describe('formatBirr', () => {
  it('groups thousands and keeps two decimals', () => {
    expect(formatBirr('3500')).toBe('3,500.00 ብር');
    expect(formatBirr('1234567.5')).toBe('1,234,567.50 ብር');
    expect(formatBirr('99.99')).toBe('99.99 ብር');
  });
});
