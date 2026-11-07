import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../shared/seeded-random';
import { demoProducts, demoTitle } from './demo-catalog.domain';

const photos = [
  { photo: 'boot.jpg', brand: 'Football shoes', itemCode: 'M1911' },
  { photo: 'kids.jpg', brand: 'Nike', color: 'lilac' },
];

describe('demoProducts', () => {
  const products = demoProducts(photos, seededRandom(3));

  it('names boots by item code and kids shoes by brand and colour', () => {
    expect(demoTitle({ photo: 'x.jpg', brand: 'Puma' })).toBe('Puma kids');
    expect(products.map((product) => product.product.title)).toEqual([
      'Football shoes · M1911',
      'Nike kids · lilac',
    ]);
  });

  it('prices in fifties, with a lowest price at or under the asking price', () => {
    for (const { product } of products) {
      expect(Number(product.price) % 50).toBe(0);
      if (product.pricingMode === 'negotiable') {
        expect(Money.of(product.lowestPrice).compare(Money.of(product.price))).toBeLessThanOrEqual(
          0,
        );
      }
    }
  });

  it('gives boots adult sizes and kids shoes kids sizes, all in stock', () => {
    const [boots, kids] = products;
    expect(boots?.variants.map((variant) => variant.size)).toContain('42');
    expect(kids?.variants.map((variant) => variant.size)).toContain('30');
    expect(products.flatMap((product) => product.variants).every((v) => v.stock > 0)).toBe(true);
  });
});
