import { describe, expect, it } from 'vitest';
import { draftPreview, isPriced, listingOf, type DraftView } from './listings.domain';
import { listingCallbackSchema } from './listings.schemas';

const draftId = 'd0000000-0000-4000-8000-000000000001';

const view: DraftView = {
  id: draftId,
  draft: {
    title: { en: 'Nike Air', am: 'ናይኪ ኤር' },
    description: { en: 'Black leather sneakers.', am: 'ጥቁር የቆዳ ስኒከር።' },
    category: 'sneakers',
    colors: ['black'],
    sizes: ['40', '41', '42', '42'],
  },
  pricingMode: 'fixed',
  price: '3500',
  lowestPrice: null,
  stockPerSize: 2,
};

const negotiable: DraftView = { ...view, pricingMode: 'negotiable', price: null };

describe('draftPreview', () => {
  it('shows the draft with the price from the note and Post, Edit, and Discard', () => {
    const { text, buttons } = draftPreview(view);
    expect(text).toContain('Nike Air · ናይኪ ኤር');
    expect(text).toContain('Price: 3,500.00 ብር (from your note)');
    expect(text).toContain('Sizes: 40, 41, 42, 42 · 2 of each');
    expect(buttons.map((button) => listingCallbackSchema.parse(button.data).action)).toEqual([
      'post',
      'edit',
      'discard',
    ]);
  });

  it('asks a negotiable draft for its prices in private, without Post', () => {
    const { text, buttons } = draftPreview(negotiable);
    expect(text).toContain('reply to this message with the asking and the lowest price');
    expect(buttons.map((button) => button.text)).not.toContain('📤 ለጥፍ / Post');
    expect(isPriced(negotiable)).toBe(false);
    expect(isPriced({ ...negotiable, price: '3500', lowestPrice: '3000' })).toBe(true);
  });

  it('asks for a fixed price the note did not give', () => {
    expect(draftPreview({ ...view, price: null }).text).toContain('No price yet');
  });
});

describe('listingOf', () => {
  it('makes a product with the owner price and one variant per size', () => {
    expect(listingOf(view)).toEqual({
      product: {
        title: 'Nike Air · ናይኪ ኤር',
        description: 'Black leather sneakers.\n\nጥቁር የቆዳ ስኒከር።',
        pricingMode: 'fixed',
        price: '3500',
      },
      variants: ['40', '41', '42'].map((size) => ({ size, color: 'black', stock: 2 })),
    });
  });

  it('keeps several colors out of the sizes', () => {
    const twoColors = { ...view, draft: { ...view.draft, colors: ['black', 'white'] } };
    expect(listingOf(twoColors).variants[0]?.color).toBeNull();
  });

  it('gives a negotiable product its asking and lowest prices', () => {
    const priced = { ...negotiable, price: '3500', lowestPrice: '3000' };
    expect(listingOf(priced).product).toMatchObject({ price: '3500', lowestPrice: '3000' });
  });

  it('refuses a draft without its prices', () => {
    expect(() => listingOf(negotiable)).toThrow();
  });
});
