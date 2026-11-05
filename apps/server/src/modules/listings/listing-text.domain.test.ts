import { describe, expect, it } from 'vitest';
import { readOwnerNote, readPriceReply } from './listing-text.domain';

describe('readOwnerNote', () => {
  it('reads the price after the size range and the color', () => {
    expect(readOwnerNote('Nike Air 40-44 ጥቁር 3500')).toEqual({
      pricingMode: 'fixed',
      price: '3500',
      stockPerSize: 1,
    });
  });

  it('prefers a number with a currency word, with separators and cents', () => {
    expect(readOwnerNote('Air Max 270, 3,500.50 ብር, 39-42').price).toBe('3500.50');
    expect(readOwnerNote('Jordan 1 high 4200 birr').price).toBe('4200');
  });

  it('takes the last number of 100 or more when none has a currency word', () => {
    expect(readOwnerNote('Air Max 270 40-44 3500').price).toBe('3500');
  });

  it('has no price when the note gives none', () => {
    expect(readOwnerNote('Adidas Samba 38-41 ነጭ').price).toBeUndefined();
    expect(readOwnerNote('Jordan 1 size 42').price).toBeUndefined();
  });

  it('reads the stock of each size', () => {
    expect(readOwnerNote('Nike Air 40-44 3500 x3').stockPerSize).toBe(3);
    expect(readOwnerNote('Nike Air 40-44 3500 ×2').stockPerSize).toBe(2);
    expect(readOwnerNote('Nike Air 40-44 3500, 4 each').stockPerSize).toBe(4);
  });

  it('never prices a negotiable product from the note', () => {
    expect(readOwnerNote('Nike Air 40-44 3500 negotiable')).toEqual({
      pricingMode: 'negotiable',
      price: undefined,
      stockPerSize: 1,
    });
    expect(readOwnerNote('ቦት ጫማ 39-41 በድርድር').pricingMode).toBe('negotiable');
  });
});

describe('readPriceReply', () => {
  it('reads one price, or two with the larger first', () => {
    expect(readPriceReply('3500')).toEqual(['3500']);
    expect(readPriceReply('3000 3500 ብር')).toEqual(['3500', '3000']);
    expect(readPriceReply('3,500 / 3,000')).toEqual(['3500', '3000']);
  });

  it('refuses a reply with words or more than two numbers', () => {
    expect(readPriceReply('make it 3500')).toBeUndefined();
    expect(readPriceReply('3500 3000 2500')).toBeUndefined();
    expect(readPriceReply('Nike Air 40-44')).toBeUndefined();
    expect(readPriceReply('')).toBeUndefined();
  });
});
