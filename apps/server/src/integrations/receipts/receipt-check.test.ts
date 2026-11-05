import { describe, expect, it } from 'vitest';
import { amountOf } from './receipt-check';

describe('amountOf', () => {
  it('reads birr amounts in both page formats', () => {
    expect(amountOf(' 4,500 Birr')).toBe('4500');
    expect(amountOf('20,000.00 ETB')).toBe('20000.00');
  });

  it('finds no amount in other text', () => {
    expect(amountOf('Completed')).toBeUndefined();
  });
});
