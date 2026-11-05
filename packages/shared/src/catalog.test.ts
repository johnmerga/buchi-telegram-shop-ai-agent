import { describe, expect, it } from 'vitest';
import { productInputSchema } from './catalog';

describe('productInputSchema', () => {
  it('accepts a negotiable product whose lowest price is at most the asking price', () => {
    const parsed = productInputSchema.safeParse({
      title: 'Nike Air',
      pricingMode: 'negotiable',
      price: '3500',
      lowestPrice: '3000',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a lowest price above the asking price', () => {
    const parsed = productInputSchema.safeParse({
      title: 'Nike Air',
      pricingMode: 'negotiable',
      price: '3000',
      lowestPrice: '3000.01',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires a lowest price for a negotiable product', () => {
    const parsed = productInputSchema.safeParse({
      title: 'Nike Air',
      pricingMode: 'negotiable',
      price: '3000',
    });
    expect(parsed.success).toBe(false);
  });
});
