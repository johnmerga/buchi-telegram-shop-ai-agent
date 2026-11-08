import { describe, expect, it } from 'vitest';
import {
  availableSizes,
  buyLink,
  embeddingText,
  photoQueryText,
  postContent,
  postIdFromStartPayload,
  productCard,
  rankSearchResults,
  restockedVariants,
  searchTerms,
} from './catalog.domain';

describe('availableSizes', () => {
  it('lists sizes with unreserved stock in natural order, once each', () => {
    expect(
      availableSizes([
        { size: '42', stock: 2, reserved: 0 },
        { size: '40', stock: 1, reserved: 0 },
        { size: '41', stock: 1, reserved: 1 },
        { size: '40', stock: 3, reserved: 0 },
        { size: '9', stock: 1, reserved: 0 },
      ]),
    ).toEqual(['9', '40', '42']);
  });
});

describe('postContent', () => {
  const base = { title: 'Nike Air', description: 'Black, original' };

  it('shows the price of a fixed-price product with a Buy button', () => {
    const post = postContent({ ...base, pricingMode: 'fixed', price: '3500' }, ['40', '41']);
    expect(post.caption).toContain('3,500.00 ብር');
    expect(post.caption).toContain('40, 41');
    expect(post.buttonText).toContain('Buy');
  });

  it('never shows the price of a negotiable product', () => {
    const post = postContent({ ...base, pricingMode: 'negotiable', price: '3500' }, ['40']);
    expect(post.caption).not.toContain('3,500');
    expect(post.buttonText).toContain('Ask price');
  });

  it('skips an empty description', () => {
    const post = postContent({ ...base, description: '', pricingMode: 'fixed', price: '1' }, ['M']);
    expect(post.caption).not.toContain('\n\n\n');
  });
});

describe('start payloads', () => {
  const postId = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('round-trips a post ID through the Buy link', () => {
    const link = buyLink('buchi_bot', postId);
    const payload = link.split('start=')[1] ?? '';
    expect(payload.length).toBeLessThanOrEqual(64);
    expect(postIdFromStartPayload(payload)).toBe(postId);
  });

  it('ignores other payloads', () => {
    expect(postIdFromStartPayload('drv_abc')).toBeUndefined();
    expect(postIdFromStartPayload('p_not-a-uuid')).toBeUndefined();
  });
});

describe('productCard', () => {
  const soldOut = { id: 'v3', size: '42', color: null, stock: 1, reserved: 1 };
  const variants = [
    { id: 'v1', size: '40', color: null, stock: 2, reserved: 0 },
    { id: 'v2', size: '41', color: 'Black', stock: 1, reserved: 0 },
    soldOut,
  ];
  const sneakers = {
    title: 'Nike Air',
    description: '',
    pricingMode: 'fixed' as const,
    price: '4500.00',
    variants,
  };

  it('shows a fixed price and one button per size in stock', () => {
    const card = productCard(sneakers);
    expect(card.text).toBe('Nike Air\n\nዋጋ / Price: 4,500.00 ብር\n\nመጠን ይምረጡ / Choose your size:');
    expect(card.buttons).toEqual([
      { text: '40', data: 'size:v1' },
      { text: '41 Black', data: 'size:v2' },
    ]);
  });

  it('hides the price of a negotiable product and invites an offer', () => {
    const card = productCard({ ...sneakers, pricingMode: 'negotiable' });
    expect(card.text).toContain('Ask me the price, or make an offer.');
    expect(card.text).not.toContain('4,500');
  });

  it('says sold out without buttons when no size is left', () => {
    const card = productCard({ ...sneakers, variants: [soldOut] });
    expect(card).toEqual({ text: 'Nike Air\n\nተሸጦ አልቋል / Sold out.', buttons: [] });
  });
});

describe('embeddingText', () => {
  it('joins the title and a description', () => {
    expect(embeddingText({ title: 'Nike Air', description: 'White' })).toBe('Nike Air\nWhite');
    expect(embeddingText({ title: 'Nike Air', description: '' })).toBe('Nike Air');
  });
});

describe('photoQueryText', () => {
  it('lists what the photo shows and skips what it does not', () => {
    expect(
      photoQueryText({ category: 'sneakers', colors: ['white', 'red'], brand: null, style: '' }),
    ).toBe('sneakers; white, red');
  });
});

describe('restockedVariants', () => {
  it('names the sizes whose stock rose, including a new size with stock', () => {
    const before = [
      { id: 'a', stock: 0 },
      { id: 'b', stock: 3 },
      { id: 'c', stock: 2 },
    ];
    const after = [
      { id: 'a', stock: 2 },
      { id: 'b', stock: 3 },
      { id: 'c', stock: 1 },
      { id: 'd', stock: 1 },
      { id: 'e', stock: 0 },
    ];
    expect(restockedVariants(before, after)).toEqual(['a', 'd']);
  });
});

describe('searchTerms', () => {
  it('keeps the words longer than one letter', () => {
    expect(searchTerms(' Nike  a kids ')).toEqual(['Nike', 'kids']);
  });
});

describe('rankSearchResults', () => {
  const kids = (id: string) => ({ id, title: `Kids ${id}`, description: 'የልጆች ጫማ' });
  const boots = { id: 'm1912', title: 'Football shoes · M1912', description: 'Football boots' };

  it('puts products close in meaning before those sharing only a generic word', () => {
    const words = [kids('a'), kids('b'), kids('c'), kids('d'), kids('e')];
    expect(rankSearchResults(['የእግር', 'ኳስ', 'ጫማ'], words, ['m1913', 'm1916'], 5)).toEqual([
      'm1913',
      'm1916',
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps a product holding every word, such as an item code, first', () => {
    expect(rankSearchResults(['m1912'], [boots], ['m1913', 'm1912'], 5)).toEqual([
      'm1912',
      'm1913',
    ]);
  });

  it('matches every word in the title or the description, whatever the case', () => {
    const words = [kids('a'), boots];
    expect(rankSearchResults(['FOOTBALL', 'm1912'], words, [], 5)).toEqual(['m1912', 'a']);
  });

  it('lists each product once and stops at the limit', () => {
    expect(rankSearchResults(['kids'], [kids('a'), kids('b')], ['b', 'z'], 2)).toEqual(['a', 'b']);
  });
});
