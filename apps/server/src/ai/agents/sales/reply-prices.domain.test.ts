import { describe, expect, it } from 'vitest';
import { numbersIn, unverifiedPrices } from './reply-prices.domain';

describe('numbersIn', () => {
  it('normalizes separators and trailing zeros', () => {
    expect(numbersIn('{"price":"4500.00","asking":"1,000.50","stock":3}')).toEqual([
      '4500',
      '1000.5',
      '3',
    ]);
  });
});

describe('unverifiedPrices', () => {
  it('accepts amounts that a trusted source gave, however they are written', () => {
    expect(unverifiedPrices('It is 4,500 birr, or 4500.00 ብር.', ['4500'])).toEqual([]);
  });

  it('finds an amount that no tool gave', () => {
    expect(unverifiedPrices('OK, 800 ብር ይሁንልዎ።', ['900'])).toEqual(['800']);
  });

  it('finds an amount written right before the currency in Amharic', () => {
    expect(unverifiedPrices('800ብር', [])).toEqual(['800']);
  });

  it('finds an amount after a separator that is not a thousands group', () => {
    expect(unverifiedPrices('price:,800', [])).toEqual(['800']);
  });

  it('ignores sizes, counts, and times', () => {
    expect(unverifiedPrices('Size 42 is left, 2 pairs, pay within 3 hours by 18:00.', [])).toEqual(
      [],
    );
  });

  it('checks a small number when a currency follows it', () => {
    expect(unverifiedPrices('Only 40 birr more.', [])).toEqual(['40']);
  });

  it('ignores the digits of an order reference', () => {
    expect(unverifiedPrices('Order #3F2A99 is on its way.', [])).toEqual([]);
  });
});
