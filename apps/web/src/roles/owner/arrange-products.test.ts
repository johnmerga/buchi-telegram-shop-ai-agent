import type { ProductWithVariants } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { arrangeProducts } from './inventory-screen';

function product(
  title: string,
  createdAt: string,
  variants: { size: string; color: string | null }[] = [],
): ProductWithVariants {
  return {
    id: title,
    title,
    description: title === 'Kids sneakers' ? 'Soft sole for school' : '',
    pricingMode: 'fixed',
    price: '1000.00',
    lowestPrice: null,
    photoFileIds: [],
    active: true,
    createdAt,
    variants: variants.map((variant, index) => ({
      id: `${title}-${String(index)}`,
      stock: 1,
      reserved: 0,
      ...variant,
    })),
  };
}

const boots = product('Football boots M1912', '2026-11-01T08:00:00.000Z', [
  { size: '42', color: 'black' },
]);
const sneakers = product('Kids sneakers', '2026-11-03T08:00:00.000Z', [
  { size: '30', color: 'white' },
]);
const sandals = product('Leather sandals', '2026-11-02T08:00:00.000Z');

describe('arrangeProducts', () => {
  it('puts the newest product first', () => {
    expect(arrangeProducts([boots, sneakers, sandals], '').map((p) => p.title)).toEqual([
      'Kids sneakers',
      'Leather sandals',
      'Football boots M1912',
    ]);
  });

  it('matches the title, description, size, and colour, ignoring case', () => {
    const titles = (search: string) =>
      arrangeProducts([boots, sneakers, sandals], search).map((p) => p.title);
    expect(titles('m1912')).toEqual(['Football boots M1912']);
    expect(titles('school')).toEqual(['Kids sneakers']);
    expect(titles('30 WHITE')).toEqual(['Kids sneakers']);
    expect(titles('boots white')).toEqual([]);
  });
});
